import type {
  Pool,
  PoolClient,
  QueryResultRow,
} from "pg";

import {
  createManagementReleaseCursor,
  maximumManagementAuditEvents,
  maximumManagementDeploymentAttempts,
  maximumManagementFindings,
  maximumManagementObservationsPerAttempt,
  maximumManagementWorkflowRuns,
  parseManagementReleaseDetail,
  parseManagementReleaseList,
} from "../dto/management-report.js";
import type {
  ManagementReleaseDetailDto,
  ManagementReleaseDetailQuery,
  ManagementReleaseListDto,
  ManagementReleaseListQuery,
  ManagementReleaseSummaryDto,
} from "../dto/management-report.js";
import {
  HttpError,
} from "../middleware/http-error.js";
import type {
  ManagementReportStore,
} from "./management-report-store.js";

interface RepositoryRow
extends QueryResultRow {
  readonly repository_id: string;
  readonly owner: string;
  readonly name: string;
}

interface ReleaseSummaryRow
extends QueryResultRow {
  readonly release_id: string;
  readonly base_sha: string | null;
  readonly head_sha: string;
  readonly release_status:
    | "PENDING"
    | "REVIEWED"
    | "DEPLOYING"
    | "COMPLETED"
    | "SUPERSEDED"
    | "CANCELLED";
  readonly release_created_at:
    Date | string;
  readonly release_updated_at:
    Date | string;
  readonly pull_request_number:
    number | null;
  readonly pull_request_state:
    "OPEN" | "CLOSED" | null;
  readonly pull_request_draft:
    boolean | null;
  readonly pull_request_title:
    string | null;
  readonly prediction_risk_score:
    number | null;
  readonly prediction_risk_level:
    "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  readonly recommended_strategy:
    "BLOCKED" | "CANARY" | "STANDARD" | null;
  readonly prediction_traffic_percent:
    number | null;
  readonly policy_decision:
    "CONTINUE" | "BLOCK" | null;
  readonly policy_deployment_strategy:
    "BLOCKED" | "CANARY" | "STANDARD" | null;
  readonly policy_traffic_percent:
    number | null;
  readonly policy_overrides: unknown;
  readonly model_provider:
    "MOCK" | "OPENAI" | null;
  readonly model_target: string | null;
  readonly prompt_version: string | null;
  readonly advisory_decision:
    "CONTINUE" | "BLOCK" | null;
  readonly model_risk_score:
    number | null;
  readonly latency_ms:
    number | string | null;
  readonly input_tokens:
    number | null;
  readonly output_tokens:
    number | null;
  readonly estimated_cost_usd:
    string | number | null;
  readonly finding_count:
    number | null;
  readonly required_action_count:
    number | null;
  readonly ci_diagnosis_category:
    string | null;
  readonly outcome:
    | "CONTINUED"
    | "PROMOTED"
    | "ROLLED_BACK"
    | "BLOCKED"
    | "FAILED"
    | null;
  readonly prediction_directionally_correct:
    boolean | null;
  readonly outcome_recorded_at:
    Date | string | null;
}

interface WorkflowRunRow
extends QueryResultRow {
  readonly workflow_run_id: string;
  readonly run_attempt: number;
  readonly workflow_name: string;
  readonly head_sha: string;
  readonly conclusion: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface FindingRow
extends QueryResultRow {
  readonly code: string;
  readonly severity:
    | "LOW"
    | "MEDIUM"
    | "HIGH"
    | "CRITICAL";
  readonly title: string;
  readonly explanation: string;
  readonly file_path: string | null;
  readonly blocking: boolean;
  readonly evidence_source:
    "TRIVY" | null;
  readonly evidence_source_version:
    string | null;
  readonly evidence_identifier:
    string | null;
  readonly evidence_category:
    | "DEPENDENCY_VULNERABILITY"
    | "CONTAINER_VULNERABILITY"
    | "INFRASTRUCTURE_MISCONFIGURATION"
    | null;
  readonly evidence_generated_at:
    Date | string | null;
  readonly created_at: Date | string;
}

interface DeploymentAttemptRow
extends QueryResultRow {
  readonly deployment_attempt_id: string;
  readonly provider: string;
  readonly external_deployment_id:
    string | null;
  readonly strategy: "CANARY" | "STANDARD";
  readonly initial_traffic_percent: number;
  readonly status:
    | "STARTED"
    | "OBSERVING"
    | "PROMOTED"
    | "ROLLED_BACK"
    | "FAILED"
    | "CANCELLED";
  readonly started_at: Date | string;
  readonly completed_at:
    Date | string | null;
}

interface ObservationRow
extends QueryResultRow {
  readonly observation_id: string;
  readonly deployment_attempt_id: string;
  readonly observed_at: Date | string;
  readonly traffic_percent: number;
  readonly health_status:
    | "HEALTHY"
    | "UNHEALTHY"
    | "UNKNOWN";
  readonly error_rate_threshold_passed:
    boolean | null;
  readonly latency_threshold_passed:
    boolean | null;
  readonly sample_size: number | null;
}

interface AuditEventRow
extends QueryResultRow {
  readonly event_type: string;
  readonly actor_type:
    | "SYSTEM"
    | "GITHUB_APP"
    | "USER";
  readonly occurred_at: Date | string;
}

interface BoundedRows<T> {
  readonly rows: readonly T[];
  readonly truncated: boolean;
}

function boundRows<T>(
  rows: readonly T[],
  maximum: number,
): BoundedRows<T> {
  return {
    rows: rows.slice(0, maximum),
    truncated: rows.length > maximum,
  };
}

function asIsoDateTime(
  value: Date | string,
  name: string,
): string {
  const date = value instanceof Date
    ? value
    : new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new Error(
      `${name} is not a valid timestamp.`,
    );
  }

  return date.toISOString();
}

function asNumber(
  value: number | string,
  name: string,
): number {
  const result = typeof value === "number"
    ? value
    : Number(value);

  if (!Number.isFinite(result)) {
    throw new Error(
      `${name} is not a finite number.`,
    );
  }

  return result;
}

function asSafeInteger(
  value: number | string,
  name: string,
): number {
  const result = asNumber(value, name);

  if (!Number.isSafeInteger(result)) {
    throw new Error(
      `${name} is outside the supported integer range.`,
    );
  }

  return result;
}

function asPositiveIdentifier(
  value: string,
  name: string,
): string {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(
      `${name} is not a positive identifier.`,
    );
  }

  return value;
}

function asPolicyOverrides(
  value: unknown,
): readonly string[] {
  const parsed = typeof value === "string"
    ? JSON.parse(value) as unknown
    : value;

  if (
    !Array.isArray(parsed)
    || parsed.some(
      (item) => typeof item !== "string",
    )
  ) {
    throw new Error(
      "policy_overrides is not a string array.",
    );
  }

  return parsed;
}

function createRepositoryNotFoundError(): HttpError {
  return new HttpError({
    statusCode: 404,
    code:
      "MANAGEMENT_REPOSITORY_NOT_FOUND",
    message:
      "The requested repository was not found.",
  });
}

function createReleaseNotFoundError(): HttpError {
  return new HttpError({
    statusCode: 404,
    code:
      "MANAGEMENT_RELEASE_NOT_FOUND",
    message:
      "The requested release was not found in the repository.",
  });
}

async function readOnlyTransaction<T>(
  pool: Pool,
  operation: (
    client: PoolClient,
  ) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
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

async function findRepository(
  client: PoolClient,
  owner: string,
  name: string,
): Promise<RepositoryRow> {
  const result = await client.query<
    RepositoryRow
  >(
    `SELECT
       repository_id::text,
       owner,
       name
     FROM repositories
     WHERE lower(owner) = lower($1)
       AND lower(name) = lower($2)`,
    [
      owner,
      name,
    ],
  );
  const row = result.rows[0];

  if (row === undefined) {
    throw createRepositoryNotFoundError();
  }

  asPositiveIdentifier(
    row.repository_id,
    "repository_id",
  );

  return row;
}

const releaseSummarySelect = `
  SELECT
    r.release_id::text,
    r.base_sha,
    r.head_sha,
    r.status AS release_status,
    r.created_at AS release_created_at,
    r.updated_at AS release_updated_at,
    pr.github_pull_request_number
      AS pull_request_number,
    pr.state AS pull_request_state,
    pr.draft AS pull_request_draft,
    pr.title AS pull_request_title,
    prediction.risk_score
      AS prediction_risk_score,
    prediction.risk_level
      AS prediction_risk_level,
    prediction.recommended_strategy,
    prediction.initial_traffic_percent
      AS prediction_traffic_percent,
    policy.decision AS policy_decision,
    policy.deployment_strategy
      AS policy_deployment_strategy,
    policy.initial_traffic_percent
      AS policy_traffic_percent,
    policy.policy_overrides,
    model.provider AS model_provider,
    model.model_target,
    model.prompt_version,
    model.advisory_decision,
    model.risk_score AS model_risk_score,
    model.latency_ms,
    model.input_tokens,
    model.output_tokens,
    model.estimated_cost_usd,
    model.finding_count,
    model.required_action_count,
    model.ci_diagnosis_category,
    outcome.outcome,
    outcome.prediction_directionally_correct,
    outcome.recorded_at AS outcome_recorded_at
  FROM releases AS r
  LEFT JOIN pull_requests AS pr
    ON pr.pull_request_id = r.pull_request_id
  LEFT JOIN review_predictions AS prediction
    ON prediction.release_id = r.release_id
  LEFT JOIN policy_decisions AS policy
    ON policy.release_id = r.release_id
  LEFT JOIN model_assessments AS model
    ON model.release_id = r.release_id
  LEFT JOIN release_outcomes AS outcome
    ON outcome.release_id = r.release_id`;

function createReleaseSummary(
  row: ReleaseSummaryRow,
): ManagementReleaseSummaryDto {
  const prediction =
    row.prediction_risk_score === null
      ? undefined
      : {
          riskScore:
            row.prediction_risk_score,
          riskLevel:
            row.prediction_risk_level,
          recommendedStrategy:
            row.recommended_strategy,
          initialTrafficPercent:
            row.prediction_traffic_percent,
        };

  const policyDecision =
    row.policy_decision === null
      ? undefined
      : {
          decision: row.policy_decision,
          deploymentStrategy:
            row.policy_deployment_strategy,
          initialTrafficPercent:
            row.policy_traffic_percent,
          policyOverrides:
            asPolicyOverrides(
              row.policy_overrides,
            ),
        };

  const modelAssessment =
    row.model_provider === null
      ? undefined
      : {
          provider: row.model_provider,
          modelTarget: row.model_target,
          promptVersion: row.prompt_version,
          advisoryDecision:
            row.advisory_decision,
          riskScore: row.model_risk_score,
          latencyMs: asNumber(
            row.latency_ms ?? Number.NaN,
            "latency_ms",
          ),
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          ...(
            row.estimated_cost_usd === null
              ? {}
              : {
                  estimatedCostUsd:
                    asNumber(
                      row.estimated_cost_usd,
                      "estimated_cost_usd",
                    ),
                }
          ),
          findingCount: row.finding_count,
          requiredActionCount:
            row.required_action_count,
          ...(
            row.ci_diagnosis_category
              === null
              ? {}
              : {
                  ciDiagnosisCategory:
                    row.ci_diagnosis_category,
                }
          ),
        };

  const outcome = row.outcome === null
    ? undefined
    : {
        outcome: row.outcome,
        ...(
          row.prediction_directionally_correct
            === null
            ? {}
            : {
                predictionDirectionallyCorrect:
                  row.prediction_directionally_correct,
              }
        ),
        recordedAt: asIsoDateTime(
          row.outcome_recorded_at
            ?? "invalid",
          "outcome_recorded_at",
        ),
      };

  return {
    releaseId: row.release_id,
    ...(row.base_sha === null
      ? {}
      : {
          baseSha: row.base_sha,
        }),
    headSha: row.head_sha,
    status: row.release_status,
    ...(
      row.pull_request_number === null
        ? {}
        : {
            pullRequest: {
              number:
                row.pull_request_number,
              state:
                row.pull_request_state,
              draft:
                row.pull_request_draft,
              ...(
                row.pull_request_title === null
                  ? {}
                  : {
                      title:
                        row.pull_request_title,
                    }
              ),
            },
          }
    ),
    ...(prediction === undefined
      ? {}
      : {
          prediction,
        }),
    ...(policyDecision === undefined
      ? {}
      : {
          policyDecision,
        }),
    ...(modelAssessment === undefined
      ? {}
      : {
          modelAssessment,
        }),
    ...(outcome === undefined
      ? {}
      : {
          outcome,
        }),
    createdAt: asIsoDateTime(
      row.release_created_at,
      "release_created_at",
    ),
    updatedAt: asIsoDateTime(
      row.release_updated_at,
      "release_updated_at",
    ),
  } as ManagementReleaseSummaryDto;
}

export class PostgresManagementReportStore
implements ManagementReportStore {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async listReleases(
    query: ManagementReleaseListQuery,
  ): Promise<ManagementReleaseListDto> {
    return readOnlyTransaction(
      this.pool,
      async (client) => {
        const repository =
          await findRepository(
            client,
            query.repositoryOwner,
            query.repositoryName,
          );

        const result = await client.query<
          ReleaseSummaryRow
        >(
          `${releaseSummarySelect}
           WHERE r.repository_id = $1
             AND (
               $2::timestamptz IS NULL
               OR r.created_at < $2::timestamptz
               OR (
                 r.created_at = $2::timestamptz
                 AND r.release_id < $3::uuid
               )
             )
           ORDER BY
             r.created_at DESC,
             r.release_id DESC
           LIMIT $4`,
          [
            repository.repository_id,
            query.cursor?.createdAt ?? null,
            query.cursor?.releaseId ?? null,
            query.limit + 1,
          ],
        );

        const bounded = boundRows(
          result.rows,
          query.limit,
        );
        const releases = bounded.rows.map(
          createReleaseSummary,
        );
        const lastRow =
          bounded.rows.at(-1);

        return parseManagementReleaseList({
          repository: {
            owner: repository.owner,
            name: repository.name,
          },
          releases,
          ...(
            bounded.truncated
            && lastRow !== undefined
              ? {
                  nextCursor:
                    createManagementReleaseCursor({
                      version: 1,
                      repositoryOwner:
                        repository.owner,
                      repositoryName:
                        repository.name,
                      createdAt:
                        asIsoDateTime(
                          lastRow
                            .release_created_at,
                          "release_created_at",
                        ),
                      releaseId:
                        lastRow.release_id,
                    }),
                }
              : {}
          ),
        });
      },
    );
  }

  async getRelease(
    query: ManagementReleaseDetailQuery,
  ): Promise<ManagementReleaseDetailDto> {
    return readOnlyTransaction(
      this.pool,
      async (client) => {
        const repository =
          await findRepository(
            client,
            query.repositoryOwner,
            query.repositoryName,
          );

        const releaseResult =
          await client.query<
            ReleaseSummaryRow
          >(
            `${releaseSummarySelect}
             WHERE r.repository_id = $1
               AND r.release_id = $2::uuid`,
            [
              repository.repository_id,
              query.releaseId,
            ],
          );
        const releaseRow =
          releaseResult.rows[0];

        if (releaseRow === undefined) {
          throw createReleaseNotFoundError();
        }

        const workflowResult =
          await client.query<WorkflowRunRow>(
            `SELECT
               workflow_run_id::text,
               run_attempt,
               workflow_name,
               head_sha,
               conclusion,
               created_at,
               updated_at
             FROM workflow_runs
             WHERE release_id = $1::uuid
             ORDER BY
               created_at,
               workflow_run_id,
               run_attempt
             LIMIT $2`,
            [
              query.releaseId,
              maximumManagementWorkflowRuns
                + 1,
            ],
          );

        const findingResult =
          await client.query<FindingRow>(
            `SELECT
               code,
               severity,
               title,
               explanation,
               file_path,
               blocking,
               evidence_source,
               evidence_source_version,
               evidence_identifier,
               evidence_category,
               evidence_generated_at,
               created_at
             FROM deterministic_findings
             WHERE release_id = $1::uuid
             ORDER BY finding_id
             LIMIT $2`,
            [
              query.releaseId,
              maximumManagementFindings + 1,
            ],
          );

        const attemptResult =
          await client.query<
            DeploymentAttemptRow
          >(
            `SELECT
               deployment_attempt_id::text,
               provider,
               external_deployment_id,
               strategy,
               initial_traffic_percent,
               status,
               started_at,
               completed_at
             FROM deployment_attempts
             WHERE release_id = $1::uuid
             ORDER BY
               started_at,
               deployment_attempt_id
             LIMIT $2`,
            [
              query.releaseId,
              maximumManagementDeploymentAttempts
                + 1,
            ],
          );
        const attempts = boundRows(
          attemptResult.rows,
          maximumManagementDeploymentAttempts,
        );
        const attemptIds = attempts.rows.map(
          (row) => row.deployment_attempt_id,
        );

        const observationResult =
          attemptIds.length === 0
            ? {
                rows: [] as readonly ObservationRow[],
              }
            : await client.query<
                ObservationRow
              >(
                `SELECT
                   observation_id::text,
                   deployment_attempt_id::text,
                   observed_at,
                   traffic_percent,
                   health_status,
                   error_rate_threshold_passed,
                   latency_threshold_passed,
                   sample_size
                 FROM (
                   SELECT
                     observation_id,
                     deployment_attempt_id,
                     observed_at,
                     traffic_percent,
                     health_status,
                     error_rate_threshold_passed,
                     latency_threshold_passed,
                     sample_size,
                     row_number() OVER (
                       PARTITION BY deployment_attempt_id
                       ORDER BY
                         observed_at,
                         observation_id
                     ) AS observation_position
                   FROM canary_observations
                   WHERE release_id = $1::uuid
                     AND deployment_attempt_id
                       = ANY($2::uuid[])
                 ) AS bounded_observations
                 WHERE observation_position <= $3
                 ORDER BY
                   deployment_attempt_id,
                   observed_at,
                   observation_id`,
                [
                  query.releaseId,
                  attemptIds,
                  maximumManagementObservationsPerAttempt
                    + 1,
                ],
              );

        const auditResult =
          await client.query<AuditEventRow>(
            `SELECT
               event_type,
               actor_type,
               occurred_at
             FROM audit_events
             WHERE release_id = $1::uuid
             ORDER BY
               occurred_at,
               audit_event_id
             LIMIT $2`,
            [
              query.releaseId,
              maximumManagementAuditEvents + 1,
            ],
          );

        const workflowRuns = boundRows(
          workflowResult.rows,
          maximumManagementWorkflowRuns,
        );
        const findings = boundRows(
          findingResult.rows,
          maximumManagementFindings,
        );
        const auditEvents = boundRows(
          auditResult.rows,
          maximumManagementAuditEvents,
        );
        const observationsByAttempt =
          new Map<
            string,
            {
              items: Array<{
                observationId: string;
                observedAt: string;
                trafficPercent: number;
                healthStatus:
                  | "HEALTHY"
                  | "UNHEALTHY"
                  | "UNKNOWN";
                errorRateThresholdPassed?:
                  boolean;
                latencyThresholdPassed?:
                  boolean;
                sampleSize?: number;
              }>;
              truncated: boolean;
            }
          >();

        for (const row of observationResult.rows) {
          const section =
            observationsByAttempt.get(
              row.deployment_attempt_id,
            ) ?? {
              items: [],
              truncated: false,
            };

          if (
            section.items.length
            < maximumManagementObservationsPerAttempt
          ) {
            section.items.push({
              observationId:
                row.observation_id,
              observedAt: asIsoDateTime(
                row.observed_at,
                "observed_at",
              ),
              trafficPercent:
                row.traffic_percent,
              healthStatus:
                row.health_status,
              ...(
                row.error_rate_threshold_passed
                  === null
                  ? {}
                  : {
                      errorRateThresholdPassed:
                        row.error_rate_threshold_passed,
                    }
              ),
              ...(
                row.latency_threshold_passed
                  === null
                  ? {}
                  : {
                      latencyThresholdPassed:
                        row.latency_threshold_passed,
                    }
              ),
              ...(
                row.sample_size === null
                  ? {}
                  : {
                      sampleSize:
                        row.sample_size,
                    }
              ),
            });
          } else {
            section.truncated = true;
          }

          observationsByAttempt.set(
            row.deployment_attempt_id,
            section,
          );
        }

        return parseManagementReleaseDetail({
          repository: {
            owner: repository.owner,
            name: repository.name,
          },
          release:
            createReleaseSummary(releaseRow),
          workflowRuns: {
            items: workflowRuns.rows.map(
              (row) => ({
                workflowRunId:
                  asSafeInteger(
                    row.workflow_run_id,
                    "workflow_run_id",
                  ),
                runAttempt: row.run_attempt,
                workflowName:
                  row.workflow_name,
                headSha: row.head_sha,
                conclusion: row.conclusion,
                createdAt: asIsoDateTime(
                  row.created_at,
                  "workflow_run.created_at",
                ),
                updatedAt: asIsoDateTime(
                  row.updated_at,
                  "workflow_run.updated_at",
                ),
              }),
            ),
            truncated: workflowRuns.truncated,
          },
          deterministicFindings: {
            items: findings.rows.map(
              (row) => ({
                code: row.code,
                severity: row.severity,
                title: row.title,
                explanation: row.explanation,
                ...(row.file_path === null
                  ? {}
                  : {
                      filePath: row.file_path,
                    }),
                blocking: row.blocking,
                ...(
                  row.evidence_source == null
                  || row.evidence_source_version == null
                  || row.evidence_identifier == null
                  || row.evidence_category == null
                  || row.evidence_generated_at == null
                    ? {}
                    : {
                        evidenceAttribution: {
                          source:
                            row.evidence_source,
                          sourceVersion:
                            row.evidence_source_version,
                          identifier:
                            row.evidence_identifier,
                          category:
                            row.evidence_category,
                          generatedAt:
                            asIsoDateTime(
                              row.evidence_generated_at,
                              "finding.evidence_generated_at",
                            ),
                        },
                      }
                ),
                createdAt: asIsoDateTime(
                  row.created_at,
                  "finding.created_at",
                ),
              }),
            ),
            truncated: findings.truncated,
          },
          deploymentAttempts: {
            items: attempts.rows.map(
              (row) => {
                const observations =
                  observationsByAttempt.get(
                    row.deployment_attempt_id,
                  ) ?? {
                    items: [],
                    truncated: false,
                  };

                return {
                  deploymentAttemptId:
                    row.deployment_attempt_id,
                  provider: row.provider,
                  ...(
                    row.external_deployment_id
                      === null
                      ? {}
                      : {
                          externalDeploymentId:
                            row.external_deployment_id,
                        }
                  ),
                  strategy: row.strategy,
                  initialTrafficPercent:
                    row.initial_traffic_percent,
                  status: row.status,
                  startedAt: asIsoDateTime(
                    row.started_at,
                    "deployment.started_at",
                  ),
                  ...(
                    row.completed_at === null
                      ? {}
                      : {
                          completedAt:
                            asIsoDateTime(
                              row.completed_at,
                              "deployment.completed_at",
                            ),
                        }
                  ),
                  observations:
                    observations.items,
                  observationsTruncated:
                    observations.truncated,
                };
              },
            ),
            truncated: attempts.truncated,
          },
          auditEvents: {
            items: auditEvents.rows.map(
              (row) => ({
                eventType: row.event_type,
                actorType: row.actor_type,
                occurredAt: asIsoDateTime(
                  row.occurred_at,
                  "audit_event.occurred_at",
                ),
              }),
            ),
            truncated: auditEvents.truncated,
          },
        });
      },
    );
  }
}
