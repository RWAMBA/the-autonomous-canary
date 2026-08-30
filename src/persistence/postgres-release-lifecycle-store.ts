import {
  randomUUID,
} from "node:crypto";

import {
  Pool,
} from "pg";
import type {
  PoolClient,
  QueryResultRow,
} from "pg";

import {
  parseGitHubWorkflowRunTask,
} from "../github/github-workflow-task.js";
import {
  HttpError,
} from "../middleware/http-error.js";
import type {
  DeploymentEventDto,
  DeploymentEventReceiptDto,
} from "../dto/deployment-event.js";
import type {
  EnabledPostgresPersistenceConfig,
} from "./persistence-config.js";
import type {
  ClaimedWorkflowRunTask,
  IgnoredWebhookDeliveryInput,
  PullRequestDeliveryInput,
  PullRequestDeliveryResult,
  ReleaseLifecycleStore,
  ReviewLifecycleRecord,
  WorkflowRunDeliveryInput,
  WorkflowRunDeliveryResult,
} from "./release-lifecycle-store.js";
import {
  recordPostgresDeploymentEvent,
} from "./postgres-deployment-event-store.js";

interface RepositoryRow
extends QueryResultRow {
  readonly repository_id: string;
}

interface PullRequestRow
extends QueryResultRow {
  readonly pull_request_id: string;
  readonly head_sha: string;
  readonly state: "OPEN" | "CLOSED";
}

interface ReleaseRow
extends QueryResultRow {
  readonly release_id: string;
}

interface ClaimedTaskRow
extends QueryResultRow {
  readonly task_id: string;
  readonly attempts: number;
  readonly release_id: string;
  readonly delivery_id: string;
  readonly installation_id: string;
  readonly repository_owner: string;
  readonly repository_name: string;
  readonly workflow_run_id: string;
  readonly run_attempt: number;
  readonly head_sha: string;
  readonly conclusion: string;
  readonly pull_request_number: number;
}

const migrationVersions = [
  "001_release_lifecycle",
  "002_deployment_event_ingestion",
] as const;

function isUniqueViolation(
  error: unknown,
): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "23505";
}

function createReplayError(
  cause: unknown,
): HttpError {
  return new HttpError({
    statusCode: 409,
    code:
      "GITHUB_WEBHOOK_DELIVERY_REPLAYED",
    message:
      "The GitHub webhook delivery has already been received.",
    cause,
  });
}

function asSafeInteger(
  value: string,
  name: string,
): number {
  const result = Number(value);

  if (
    !Number.isSafeInteger(result)
    || result <= 0
  ) {
    throw new Error(
      `${name} is outside the supported integer range.`,
    );
  }

  return result;
}

async function transaction<T>(
  pool: Pool,
  operation: (
    client: PoolClient,
  ) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertRepository(
  client: PoolClient,
  input: {
    readonly githubRepositoryId?: number;
    readonly installationId?: number;
    readonly owner: string;
    readonly name: string;
  },
): Promise<number> {
  if (input.installationId !== undefined) {
    await client.query(
      `INSERT INTO github_installations (
         installation_id,
         account_login
       ) VALUES ($1, $2)
       ON CONFLICT (installation_id)
       DO UPDATE SET
         account_login = EXCLUDED.account_login,
         updated_at = now()`,
      [
        input.installationId,
        input.owner,
      ],
    );
  }

  await client.query(
    `INSERT INTO repositories (
       github_repository_id,
       installation_id,
       owner,
       name
     ) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [
      input.githubRepositoryId ?? null,
      input.installationId ?? null,
      input.owner,
      input.name,
    ],
  );

  const result = await client.query<
    RepositoryRow
  >(
    `UPDATE repositories
     SET github_repository_id = COALESCE($1, github_repository_id),
         installation_id = COALESCE($2, installation_id),
         owner = $3,
         name = $4,
         updated_at = now()
     WHERE ($1::bigint IS NOT NULL AND github_repository_id = $1)
        OR (lower(owner) = lower($3) AND lower(name) = lower($4))
     RETURNING repository_id::text`,
    [
      input.githubRepositoryId ?? null,
      input.installationId ?? null,
      input.owner,
      input.name,
    ],
  );

  const row = result.rows[0];

  if (row === undefined) {
    throw new Error(
      "Repository persistence did not return an identifier.",
    );
  }

  return asSafeInteger(
    row.repository_id,
    "repository_id",
  );
}

async function findOrCreateRelease(
  client: PoolClient,
  input: {
    readonly repositoryId: number;
    readonly pullRequestId?: number;
    readonly baseSha?: string;
    readonly headSha: string;
    readonly releaseId?: string;
  },
): Promise<string> {
  const releaseId =
    input.releaseId ?? randomUUID();

  const result = await client.query<
    ReleaseRow
  >(
    `INSERT INTO releases (
       release_id,
       repository_id,
       pull_request_id,
       base_sha,
       head_sha
     ) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (repository_id, head_sha)
     DO UPDATE SET
       pull_request_id = COALESCE(EXCLUDED.pull_request_id, releases.pull_request_id),
       base_sha = COALESCE(EXCLUDED.base_sha, releases.base_sha),
       updated_at = now()
     RETURNING release_id::text`,
    [
      releaseId,
      input.repositoryId,
      input.pullRequestId ?? null,
      input.baseSha ?? null,
      input.headSha,
    ],
  );

  const row = result.rows[0];

  if (row === undefined) {
    throw new Error(
      "Release persistence did not return an identifier.",
    );
  }

  return row.release_id;
}

export function createPostgresPool(
  config: EnabledPostgresPersistenceConfig,
): Pool {
  return new Pool({
    connectionString:
      normalizePostgresConnectionUrl(
        config.databaseUrl,
        config.sslMode,
      ),
    max: config.poolMaximum,
    connectionTimeoutMillis:
      config.connectionTimeoutMs,
    statement_timeout:
      config.statementTimeoutMs,
    query_timeout:
      config.statementTimeoutMs,
    ssl: config.sslMode === "REQUIRE"
      ? {
          rejectUnauthorized: true,
        }
      : false,
  });
}

export function normalizePostgresConnectionUrl(
  databaseUrl: string,
  sslMode: EnabledPostgresPersistenceConfig["sslMode"],
): string {
  const url = new URL(databaseUrl);

  url.searchParams.set(
    "sslmode",
    sslMode === "REQUIRE"
      ? "verify-full"
      : "disable",
  );

  return url.toString();
}

export class PostgresReleaseLifecycleStore
implements ReleaseLifecycleStore {
  readonly durable = true as const;

  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async verifySchema(): Promise<void> {
    const result = await this.pool.query<{
      readonly version: string;
    }>(
      `SELECT version
       FROM schema_migrations
       WHERE version = ANY($1::text[])`,
      [
        migrationVersions,
      ],
    );

    const appliedVersions = new Set(
      result.rows.map((row) => row.version),
    );
    const missingVersion =
      migrationVersions.find(
        (version) =>
          !appliedVersions.has(version),
      );

    if (missingVersion !== undefined) {
      throw new Error(
        `Database migration ${missingVersion} has not been applied.`,
      );
    }
  }

  async recordDeploymentEvent(
    event: DeploymentEventDto,
  ): Promise<DeploymentEventReceiptDto> {
    return recordPostgresDeploymentEvent(
      this.pool,
      event,
    );
  }

  async resolveReleaseId(
    request: ReviewLifecycleRecord["request"],
    proposedReleaseId: string,
  ): Promise<string> {
    return transaction(
      this.pool,
      async (client) => {
        const repositoryId =
          await upsertRepository(
            client,
            request.repository,
          );

        return findOrCreateRelease(
          client,
          {
            repositoryId,
            baseSha: request.change.baseSha,
            headSha: request.change.headSha,
            releaseId: proposedReleaseId,
          },
        );
      },
    );
  }

  async recordReview(
    record: ReviewLifecycleRecord,
  ): Promise<void> {
    await transaction(
      this.pool,
      async (client) => {
        const repositoryId =
          await upsertRepository(
            client,
            record.request.repository,
          );

        const releaseId =
          await findOrCreateRelease(
            client,
            {
              repositoryId,
              baseSha:
                record.request.change.baseSha,
              headSha:
                record.request.change.headSha,
              releaseId: record.releaseId,
            },
          );

        if (releaseId !== record.releaseId) {
          throw new HttpError({
            statusCode: 409,
            code:
              "RELEASE_IDENTITY_MISMATCH",
            message:
              "The review release identifier does not match the stored release.",
          });
        }

        await client.query(
          `UPDATE releases
           SET base_sha = $2,
               status = 'REVIEWED',
               updated_at = now()
           WHERE release_id = $1`,
          [
            releaseId,
            record.request.change.baseSha,
          ],
        );

        await client.query(
          `DELETE FROM deterministic_findings
           WHERE release_id = $1`,
          [
            releaseId,
          ],
        );

        for (
          const finding
          of record.deterministicAssessment
            .findings
        ) {
          await client.query(
            `INSERT INTO deterministic_findings (
               release_id,
               code,
               severity,
               title,
               explanation,
               file_path,
               blocking
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              releaseId,
              finding.code,
              finding.severity,
              finding.title,
              finding.explanation,
              finding.file ?? null,
              finding.blocking,
            ],
          );
        }

        await client.query(
          `INSERT INTO review_predictions (
             release_id,
             risk_score,
             risk_level,
             recommended_strategy,
             initial_traffic_percent
           ) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (release_id)
           DO UPDATE SET
             risk_score = EXCLUDED.risk_score,
             risk_level = EXCLUDED.risk_level,
             recommended_strategy = EXCLUDED.recommended_strategy,
             initial_traffic_percent = EXCLUDED.initial_traffic_percent`,
          [
            releaseId,
            record.response.risk.score,
            record.response.risk.level,
            record.response.deployment.strategy,
            record.response.deployment
              .initialTrafficPercent,
          ],
        );

        const telemetry =
          record.intelligenceResult.telemetry;

        await client.query(
          `INSERT INTO model_assessments (
             release_id,
             provider,
             model_target,
             prompt_version,
             advisory_decision,
             risk_score,
             latency_ms,
             input_tokens,
             output_tokens,
             estimated_cost_usd,
             finding_count,
             required_action_count,
             ci_diagnosis_category
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, $11, $12, $13
           )
           ON CONFLICT (release_id)
           DO UPDATE SET
             provider = EXCLUDED.provider,
             model_target = EXCLUDED.model_target,
             prompt_version = EXCLUDED.prompt_version,
             advisory_decision = EXCLUDED.advisory_decision,
             risk_score = EXCLUDED.risk_score,
             latency_ms = EXCLUDED.latency_ms,
             input_tokens = EXCLUDED.input_tokens,
             output_tokens = EXCLUDED.output_tokens,
             estimated_cost_usd = EXCLUDED.estimated_cost_usd,
             finding_count = EXCLUDED.finding_count,
             required_action_count = EXCLUDED.required_action_count,
             ci_diagnosis_category = EXCLUDED.ci_diagnosis_category`,
          [
            releaseId,
            telemetry.provider,
            telemetry.modelTarget,
            telemetry.promptVersion,
            record.intelligenceResult
              .assessment.advisoryDecision,
            record.intelligenceResult
              .assessment.riskScore,
            telemetry.latencyMs,
            telemetry.inputTokens,
            telemetry.outputTokens,
            telemetry.provider === "OPENAI"
              ? telemetry.estimatedCostUsd
              : null,
            record.intelligenceResult
              .assessment.findings.length,
            record.intelligenceResult
              .assessment.requiredActions.length,
            record.intelligenceResult
              .assessment.ciDiagnosis
              ?.failureCategory
              ?? null,
          ],
        );

        await client.query(
          `INSERT INTO policy_decisions (
             release_id,
             decision,
             deployment_strategy,
             initial_traffic_percent,
             policy_overrides
           ) VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (release_id)
           DO UPDATE SET
             decision = EXCLUDED.decision,
             deployment_strategy = EXCLUDED.deployment_strategy,
             initial_traffic_percent = EXCLUDED.initial_traffic_percent,
             policy_overrides = EXCLUDED.policy_overrides`,
          [
            releaseId,
            record.response.decision,
            record.response.deployment.strategy,
            record.response.deployment
              .initialTrafficPercent,
            JSON.stringify(
              record.response.policyOverrides,
            ),
          ],
        );

        await client.query(
          `INSERT INTO audit_events (
             release_id,
             event_type,
             actor_type,
             metadata
           ) VALUES ($1, 'REVIEW_RECORDED', 'SYSTEM', $2::jsonb)`,
          [
            releaseId,
            JSON.stringify({
              decision:
                record.response.decision,
              riskLevel:
                record.response.risk.level,
              provider:
                telemetry.provider,
              promptVersion:
                telemetry.promptVersion,
              policyOverrides:
                record.response.policyOverrides,
            }),
          ],
        );
      },
    );
  }

  async acceptPullRequestDelivery(
    input: PullRequestDeliveryInput,
  ): Promise<PullRequestDeliveryResult> {
    try {
      return await transaction(
        this.pool,
        async (client) => {
          const payload = input.payload;
          const repositoryId =
            await upsertRepository(
              client,
              {
                githubRepositoryId:
                  payload.repository.id,
                installationId:
                  payload.installation.id,
                owner:
                  payload.repository.owner.login,
                name:
                  payload.repository.name,
              },
            );

          const pullRequestResult =
            await client.query<
              PullRequestRow
            >(
              `INSERT INTO pull_requests (
                 repository_id,
                 github_pull_request_number,
                 state,
                 draft,
                 base_sha,
                 head_sha,
                 title,
                 opened_at,
                 closed_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (
                 repository_id,
                 github_pull_request_number
               ) DO UPDATE SET
                 state = EXCLUDED.state,
                 draft = EXCLUDED.draft,
                 base_sha = EXCLUDED.base_sha,
                 head_sha = EXCLUDED.head_sha,
                 title = EXCLUDED.title,
                 closed_at = EXCLUDED.closed_at,
                 updated_at = now()
               RETURNING pull_request_id::text, head_sha, state`,
              [
                repositoryId,
                payload.number,
                payload.pull_request.state
                  .toUpperCase(),
                payload.pull_request.draft,
                payload.pull_request.base.sha,
                payload.pull_request.head.sha,
                payload.pull_request.title,
                payload.pull_request.created_at,
                payload.pull_request.closed_at,
              ],
            );

          const pullRequestRow =
            pullRequestResult.rows[0];

          if (pullRequestRow === undefined) {
            throw new Error(
              "Pull request persistence did not return an identifier.",
            );
          }

          const pullRequestId =
            asSafeInteger(
              pullRequestRow.pull_request_id,
              "pull_request_id",
            );

          const releaseId =
            await findOrCreateRelease(
              client,
              {
                repositoryId,
                pullRequestId,
                baseSha:
                  payload.pull_request.base.sha,
                headSha:
                  payload.pull_request.head.sha,
              },
            );

          await client.query(
            `UPDATE releases
             SET status = 'SUPERSEDED',
                 superseded_by = $3,
                 updated_at = now()
             WHERE pull_request_id = $1
               AND head_sha <> $2
               AND status NOT IN ('COMPLETED', 'CANCELLED', 'SUPERSEDED')`,
            [
              pullRequestId,
              payload.pull_request.head.sha,
              releaseId,
            ],
          );

          await client.query(
            `UPDATE automation_tasks
             SET status = 'SUPERSEDED',
                 leased_until = NULL,
                 updated_at = now()
             WHERE release_id IN (
               SELECT release_id
               FROM releases
               WHERE pull_request_id = $1
                 AND head_sha <> $2
             )
               AND status IN ('PENDING', 'PROCESSING')`,
            [
              pullRequestId,
              payload.pull_request.head.sha,
            ],
          );

          await client.query(
            `UPDATE deployment_attempts
             SET status = 'CANCELLED',
                 completed_at = COALESCE(
                   completed_at,
                   now()
                 )
             WHERE release_id IN (
               SELECT release_id
               FROM releases
               WHERE pull_request_id = $1
                 AND head_sha <> $2
                 AND status = 'SUPERSEDED'
             )
               AND status IN (
                 'STARTED',
                 'OBSERVING'
               )`,
            [
              pullRequestId,
              payload.pull_request.head.sha,
            ],
          );

          if (payload.action === "closed") {
            await client.query(
              `UPDATE releases
               SET status = 'CANCELLED',
                   updated_at = now()
               WHERE release_id = $1`,
              [
                releaseId,
              ],
            );

            await client.query(
              `UPDATE automation_tasks
               SET status = 'SUPERSEDED',
                   leased_until = NULL,
                   updated_at = now()
               WHERE release_id = $1
                 AND status IN ('PENDING', 'PROCESSING')`,
              [
                releaseId,
              ],
            );

            await client.query(
              `UPDATE deployment_attempts
               SET status = 'CANCELLED',
                   completed_at = COALESCE(
                     completed_at,
                     now()
                   )
               WHERE release_id = $1
                 AND status IN (
                   'STARTED',
                   'OBSERVING'
                 )`,
              [
                releaseId,
              ],
            );
          } else if (
            payload.action === "reopened"
          ) {
            await client.query(
              `UPDATE releases
               SET status = 'PENDING',
                   superseded_by = NULL,
                   updated_at = now()
               WHERE release_id = $1
                 AND status = 'CANCELLED'`,
              [
                releaseId,
              ],
            );
          }

          await client.query(
            `INSERT INTO webhook_deliveries (
               delivery_id,
               event_name,
               action,
               repository_id,
               release_id,
               status
             ) VALUES ($1, 'pull_request', $2, $3, $4, 'ACCEPTED')`,
            [
              input.deliveryId,
              payload.action,
              repositoryId,
              releaseId,
            ],
          );

          await client.query(
            `INSERT INTO audit_events (
               release_id,
               event_type,
               actor_type,
               metadata
             ) VALUES ($1, 'PULL_REQUEST_RECEIVED', 'GITHUB_APP', $2::jsonb)`,
            [
              releaseId,
              JSON.stringify({
                action: payload.action,
                pullRequestNumber:
                  payload.number,
              }),
            ],
          );

          return {
            releaseId,
          };
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw createReplayError(error);
      }

      throw error;
    }
  }

  async acceptWorkflowRunDelivery(
    input: WorkflowRunDeliveryInput,
  ): Promise<WorkflowRunDeliveryResult> {
    try {
      return await transaction(
        this.pool,
        async (client) => {
          const payload = input.payload;
          const repositoryId =
            await upsertRepository(
              client,
              {
                githubRepositoryId:
                  payload.repository.id,
                installationId:
                  payload.installation.id,
                owner:
                  payload.repository.owner.login,
                name:
                  payload.repository.name,
              },
            );

          const pullRequestSummary =
            payload.workflow_run
              .pull_requests[0];

          const ignoredReason =
            payload.action !== "completed"
              ? "WORKFLOW_RUN_NOT_COMPLETED" as const
              : payload.workflow_run
                  .pull_requests.length !== 1
                ? "WORKFLOW_RUN_PULL_REQUEST_UNAVAILABLE" as const
                : undefined;

          if (
            ignoredReason !== undefined
            || pullRequestSummary === undefined
            || payload.workflow_run.conclusion
              === null
          ) {
            await client.query(
              `INSERT INTO webhook_deliveries (
                 delivery_id,
                 event_name,
                 action,
                 repository_id,
                 status,
                 reason
               ) VALUES ($1, 'workflow_run', $2, $3, 'IGNORED', $4)`,
              [
                input.deliveryId,
                payload.action,
                repositoryId,
                ignoredReason
                ?? "WORKFLOW_RUN_NOT_COMPLETED",
              ],
            );

            return {
              status: "IGNORED",
              reason: ignoredReason
              ?? "WORKFLOW_RUN_NOT_COMPLETED",
            };
          }

          let pullRequestResult =
            await client.query<
              PullRequestRow
            >(
              `SELECT
                 pull_request_id::text,
                 head_sha,
                 state
               FROM pull_requests
               WHERE repository_id = $1
                 AND github_pull_request_number = $2
               FOR UPDATE`,
              [
                repositoryId,
                pullRequestSummary.number,
              ],
            );

          if (
            pullRequestResult.rows.length === 0
          ) {
            pullRequestResult =
              await client.query<
                PullRequestRow
              >(
                `INSERT INTO pull_requests (
                   repository_id,
                   github_pull_request_number,
                   state,
                   draft,
                   head_sha
                 ) VALUES ($1, $2, 'OPEN', false, $3)
                 RETURNING pull_request_id::text, head_sha, state`,
                [
                  repositoryId,
                  pullRequestSummary.number,
                  payload.workflow_run.head_sha,
                ],
              );
          }

          const pullRequestRow =
            pullRequestResult.rows[0];

          if (pullRequestRow === undefined) {
            throw new Error(
              "Workflow pull request correlation failed.",
            );
          }

          const pullRequestId =
            asSafeInteger(
              pullRequestRow.pull_request_id,
              "pull_request_id",
            );

          if (pullRequestRow.state === "CLOSED") {
            await client.query(
              `INSERT INTO webhook_deliveries (
                 delivery_id,
                 event_name,
                 action,
                 repository_id,
                 status,
                 reason
               ) VALUES ($1, 'workflow_run', $2, $3, 'IGNORED', 'WORKFLOW_RUN_PULL_REQUEST_CLOSED')`,
              [
                input.deliveryId,
                payload.action,
                repositoryId,
              ],
            );

            return {
              status: "IGNORED",
              reason:
                "WORKFLOW_RUN_PULL_REQUEST_CLOSED",
            };
          }

          if (
            pullRequestRow.head_sha
              .toLowerCase()
            !== payload.workflow_run.head_sha
              .toLowerCase()
          ) {
            await client.query(
              `INSERT INTO webhook_deliveries (
                 delivery_id,
                 event_name,
                 action,
                 repository_id,
                 status,
                 reason
               ) VALUES ($1, 'workflow_run', $2, $3, 'IGNORED', 'WORKFLOW_RUN_HEAD_SUPERSEDED')`,
              [
                input.deliveryId,
                payload.action,
                repositoryId,
              ],
            );

            return {
              status: "IGNORED",
              reason:
                "WORKFLOW_RUN_HEAD_SUPERSEDED",
            };
          }

          const releaseId =
            await findOrCreateRelease(
              client,
              {
                repositoryId,
                pullRequestId,
                headSha:
                  payload.workflow_run.head_sha,
              },
            );

          await client.query(
            `INSERT INTO webhook_deliveries (
               delivery_id,
               event_name,
               action,
               repository_id,
               release_id,
               status
             ) VALUES ($1, 'workflow_run', $2, $3, $4, 'ACCEPTED')`,
            [
              input.deliveryId,
              payload.action,
              repositoryId,
              releaseId,
            ],
          );

          await client.query(
            `INSERT INTO workflow_runs (
               workflow_run_id,
               run_attempt,
               repository_id,
               release_id,
               pull_request_id,
               workflow_name,
               head_sha,
               conclusion
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (workflow_run_id, run_attempt)
             DO UPDATE SET
               release_id = EXCLUDED.release_id,
               conclusion = EXCLUDED.conclusion,
               updated_at = now()`,
            [
              payload.workflow_run.id,
              payload.workflow_run.run_attempt,
              repositoryId,
              releaseId,
              pullRequestId,
              payload.workflow_run.name,
              payload.workflow_run.head_sha,
              payload.workflow_run.conclusion,
            ],
          );

          const task =
            parseGitHubWorkflowRunTask({
              releaseId,
              deliveryId: input.deliveryId,
              installationId:
                payload.installation.id,
              repository: {
                owner:
                  payload.repository.owner.login,
                name:
                  payload.repository.name,
              },
              workflowRun: {
                id:
                  payload.workflow_run.id,
                runAttempt:
                  payload.workflow_run
                    .run_attempt,
                headSha:
                  payload.workflow_run
                    .head_sha,
                conclusion:
                  payload.workflow_run
                    .conclusion,
              },
              pullRequest: {
                number:
                  pullRequestSummary.number,
              },
            });

          await client.query(
            `INSERT INTO automation_tasks (
               release_id,
               delivery_id,
               workflow_run_id,
               run_attempt,
               installation_id,
               repository_owner,
               repository_name,
               pull_request_number,
               head_sha,
               conclusion
             ) VALUES (
               $1, $2, $3, $4, $5,
               $6, $7, $8, $9, $10
             )
             ON CONFLICT (workflow_run_id, run_attempt)
             DO NOTHING`,
            [
              releaseId,
              input.deliveryId,
              task.workflowRun.id,
              task.workflowRun.runAttempt,
              task.installationId,
              task.repository.owner,
              task.repository.name,
              task.pullRequest.number,
              task.workflowRun.headSha,
              task.workflowRun.conclusion,
            ],
          );

          return {
            status: "ACCEPTED",
            releaseId,
            task,
          };
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw createReplayError(error);
      }

      throw error;
    }
  }

  async acceptIgnoredDelivery(
    input: IgnoredWebhookDeliveryInput,
  ): Promise<void> {
    try {
      await transaction(
        this.pool,
        async (client) => {
          const repositoryId =
            await upsertRepository(
              client,
              {
                githubRepositoryId:
                  input.repository
                    .githubRepositoryId,
                owner:
                  input.repository.owner,
                name:
                  input.repository.name,
              },
            );

          await client.query(
            `INSERT INTO webhook_deliveries (
               delivery_id,
               event_name,
               action,
               repository_id,
               status,
               reason
             ) VALUES ($1, $2, $3, $4, 'IGNORED', $5)`,
            [
              input.deliveryId,
              input.eventName,
              input.action,
              repositoryId,
              input.reason,
            ],
          );
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw createReplayError(error);
      }

      throw error;
    }
  }

  async claimWorkflowRunTask(
    leaseMs: number,
  ): Promise<
    ClaimedWorkflowRunTask | undefined
  > {
    return transaction(
      this.pool,
      async (client) => {
        const result = await client.query<
          ClaimedTaskRow
        >(
          `WITH candidate AS (
             SELECT task_id
             FROM automation_tasks
             WHERE (
               status = 'PENDING'
               AND available_at <= now()
             ) OR (
               status = 'PROCESSING'
               AND leased_until < now()
             )
             ORDER BY task_id
             FOR UPDATE SKIP LOCKED
             LIMIT 1
           )
           UPDATE automation_tasks AS task
           SET status = 'PROCESSING',
               attempts = task.attempts + 1,
               leased_until = now() + ($1::integer * interval '1 millisecond'),
               updated_at = now()
           FROM candidate
           WHERE task.task_id = candidate.task_id
           RETURNING
             task.task_id::text,
             task.attempts,
             task.release_id::text,
             task.delivery_id::text,
             task.installation_id::text,
             task.repository_owner,
             task.repository_name,
             task.workflow_run_id::text,
             task.run_attempt,
             task.head_sha,
             task.conclusion,
             task.pull_request_number`,
          [
            leaseMs,
          ],
        );

        const row = result.rows[0];

        if (row === undefined) {
          return undefined;
        }

        return {
          taskId: asSafeInteger(
            row.task_id,
            "task_id",
          ),
          attempts: row.attempts,
          task: parseGitHubWorkflowRunTask({
            releaseId: row.release_id,
            deliveryId: row.delivery_id,
            installationId: asSafeInteger(
              row.installation_id,
              "installation_id",
            ),
            repository: {
              owner: row.repository_owner,
              name: row.repository_name,
            },
            workflowRun: {
              id: asSafeInteger(
                row.workflow_run_id,
                "workflow_run_id",
              ),
              runAttempt: row.run_attempt,
              headSha: row.head_sha,
              conclusion: row.conclusion,
            },
            pullRequest: {
              number:
                row.pull_request_number,
            },
          }),
        };
      },
    );
  }

  async completeWorkflowRunTask(
    taskId: number,
    checkRunId: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE automation_tasks
       SET status = 'COMPLETED',
           check_run_id = $2,
           leased_until = NULL,
           last_error_code = NULL,
           updated_at = now()
       WHERE task_id = $1
         AND status = 'PROCESSING'`,
      [
        taskId,
        checkRunId,
      ],
    );
  }

  async retryWorkflowRunTask(
    taskId: number,
    errorCode: string,
    retryAt: Date,
    terminal: boolean,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE automation_tasks
       SET status = $2,
           available_at = $3,
           leased_until = NULL,
           last_error_code = $4,
           updated_at = now()
       WHERE task_id = $1
         AND status = 'PROCESSING'`,
      [
        taskId,
        terminal ? "FAILED" : "PENDING",
        retryAt,
        errorCode,
      ],
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
