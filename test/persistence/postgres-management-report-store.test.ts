import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import type {
  Pool,
} from "pg";

import {
  maximumManagementAuditEvents,
  maximumManagementDeploymentAttempts,
  maximumManagementFindings,
  maximumManagementObservationsPerAttempt,
  maximumManagementWorkflowRuns,
  parseManagementReleaseListQuery,
} from "../../src/dto/management-report.js";
import {
  isHttpError,
} from "../../src/middleware/http-error.js";
import {
  PostgresManagementReportStore,
} from "../../src/persistence/postgres-management-report-store.js";

const releaseId =
  "123e4567-e89b-42d3-a456-426614174000";
const attemptId =
  "223e4567-e89b-42d3-a456-426614174000";

function normalizeSql(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function createPool(
  query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{
    readonly rows: readonly unknown[];
  }>,
): Pool {
  const client = {
    query,
    release: () => undefined,
  };

  return {
    connect: async () => client,
  } as unknown as Pool;
}

function releaseRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    release_id: releaseId,
    base_sha:
      "3b00324e355ce140a8d9ab0ffeff47f5642ba4ba",
    head_sha:
      "ae222bdc592e3721fc9024a02b20759e25cdb3f9",
    release_status: "COMPLETED",
    release_created_at:
      "2026-08-30T18:47:11.000Z",
    release_updated_at:
      "2026-08-30T18:52:22.000Z",
    pull_request_number: 21,
    pull_request_state: "CLOSED",
    pull_request_draft: false,
    pull_request_title:
      "feat: publish deployment events",
    prediction_risk_score: 72,
    prediction_risk_level: "HIGH",
    recommended_strategy: "CANARY",
    prediction_traffic_percent: 5,
    policy_decision: "CONTINUE",
    policy_deployment_strategy: "CANARY",
    policy_traffic_percent: 5,
    policy_overrides: [
      "CI_INCOMPLETE",
    ],
    model_provider: "MOCK",
    model_target:
      "mock-release-risk-v1",
    prompt_version:
      "canaryguard-review-v2",
    advisory_decision: "CONTINUE",
    model_risk_score: 60,
    latency_ms: 4.5,
    input_tokens: 0,
    output_tokens: 0,
    estimated_cost_usd: null,
    finding_count: 1,
    required_action_count: 1,
    ci_diagnosis_category:
      "INFRASTRUCTURE_FAILURE",
    outcome: "PROMOTED",
    prediction_directionally_correct: false,
    outcome_recorded_at:
      "2026-08-30T18:51:00.000Z",
    ...overrides,
  };
}

test("lists repository-scoped releases with stable keyset pagination", async () => {
  const statements: string[] = [];
  const valuesSeen: Array<
    readonly unknown[] | undefined
  > = [];
  const secondReleaseId =
    "323e4567-e89b-42d3-a456-426614174000";
  const thirdReleaseId =
    "423e4567-e89b-42d3-a456-426614174000";
  const pool = createPool(
    async (text, values) => {
      const sql = normalizeSql(text);
      statements.push(sql);
      valuesSeen.push(values);

      if (sql.includes("FROM repositories")) {
        return {
          rows: [
            {
              repository_id: "101",
              owner: "RWAMBA",
              name:
                "the-autonomous-canary",
            },
          ],
        };
      }

      if (sql.includes("FROM releases AS r")) {
        return {
          rows: [
            releaseRow(),
            releaseRow({
              release_id: secondReleaseId,
              release_created_at:
                "2026-08-30T17:45:51.000Z",
            }),
            releaseRow({
              release_id: thirdReleaseId,
              release_created_at:
                "2026-08-30T15:32:42.000Z",
            }),
          ],
        };
      }

      return {
        rows: [],
      };
    },
  );

  const result =
    await new PostgresManagementReportStore(
      pool,
    ).listReleases({
      repositoryOwner: "RWAMBA",
      repositoryName:
        "the-autonomous-canary",
      limit: 2,
    });

  assert.equal(result.releases.length, 2);
  assert.equal(
    result.releases[0]?.outcome
      ?.predictionDirectionallyCorrect,
    false,
  );
  assert.ok(result.nextCursor);

  const cursorQuery =
    parseManagementReleaseListQuery(
      new URLSearchParams({
        repositoryOwner: "RWAMBA",
        repositoryName:
          "the-autonomous-canary",
        cursor: result.nextCursor,
      }),
    );

  assert.equal(
    cursorQuery.cursor?.releaseId,
    secondReleaseId,
  );
  assert.equal(
    statements[0],
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  assert.equal(
    statements.at(-1),
    "COMMIT",
  );
  assert.equal(
    statements.some((sql) =>
      sql.includes("OFFSET")),
    false,
  );
  assert.equal(
    statements.some((sql) =>
      sql.includes("RWAMBA")),
    false,
  );
  assert.deepEqual(
    valuesSeen.find((values) =>
      values?.[0] === "RWAMBA"),
    [
      "RWAMBA",
      "the-autonomous-canary",
    ],
  );
});

test("filters release discovery by parameterized exact head SHA", async () => {
  const reviewHeadSha =
    "3128a8c383889ae107e9a999778be70a2263a21a";
  let releaseSql = "";
  let releaseValues:
    readonly unknown[] | undefined;
  const pool = createPool(
    async (text, values) => {
      const sql = normalizeSql(text);

      if (sql.includes("FROM repositories")) {
        return {
          rows: [
            {
              repository_id: "101",
              owner: "RWAMBA",
              name:
                "the-autonomous-canary",
            },
          ],
        };
      }

      if (sql.includes("FROM releases AS r")) {
        releaseSql = sql;
        releaseValues = values;

        return {
          rows: [
            releaseRow({
              head_sha: reviewHeadSha,
            }),
          ],
        };
      }

      return {
        rows: [],
      };
    },
  );

  const result =
    await new PostgresManagementReportStore(
      pool,
    ).listReleases({
      repositoryOwner: "RWAMBA",
      repositoryName:
        "the-autonomous-canary",
      headSha: reviewHeadSha,
      limit: 2,
    });

  assert.equal(
    result.releases[0]?.headSha,
    reviewHeadSha,
  );
  assert.match(
    releaseSql,
    /r\.head_sha = \$5::text/u,
  );
  assert.deepEqual(releaseValues, [
    "101",
    null,
    null,
    3,
    reviewHeadSha,
  ]);
});

test("returns a bounded normalized release detail without audit metadata", async () => {
  const statements: string[] = [];
  const pool = createPool(
    async (text) => {
      const sql = normalizeSql(text);
      statements.push(sql);

      if (sql.includes("FROM repositories")) {
        return {
          rows: [
            {
              repository_id: "101",
              owner: "RWAMBA",
              name:
                "the-autonomous-canary",
            },
          ],
        };
      }

      if (sql.includes("FROM releases AS r")) {
        return {
          rows: [
            releaseRow(),
          ],
        };
      }

      if (sql.includes("FROM workflow_runs")) {
        return {
          rows: [
            {
              workflow_run_id:
                "33329058711",
              run_attempt: 1,
              workflow_name:
                "Continuous Integration",
              head_sha:
                "ae222bdc592e3721fc9024a02b20759e25cdb3f9",
              conclusion: "success",
              created_at:
                "2026-08-30T18:47:13.000Z",
              updated_at:
                "2026-08-30T18:50:00.000Z",
            },
          ],
        };
      }

      if (
        sql.includes(
          "FROM deterministic_findings",
        )
      ) {
        return {
          rows: [
            {
              code:
                "TRIVY_DEPENDENCY_VULNERABILITY_HIGH",
              severity: "HIGH",
              title:
                "CVE-2026-1000 affects example@1.0.0",
              explanation:
                "Trivy reported a dependency vulnerability.",
              file_path: null,
              blocking: false,
              evidence_source: "TRIVY",
              evidence_source_version: "1.0.0",
              evidence_identifier:
                "CVE-2026-1000",
              evidence_category:
                "DEPENDENCY_VULNERABILITY",
              evidence_generated_at:
                "2026-08-30T18:47:59.000Z",
              created_at:
                "2026-08-30T18:48:00.000Z",
            },
          ],
        };
      }

      if (sql.includes("FROM deployment_attempts")) {
        return {
          rows: [
            {
              deployment_attempt_id:
                attemptId,
              provider: "DOCKER_COMPOSE",
              external_deployment_id: null,
              strategy: "CANARY",
              initial_traffic_percent: 5,
              status: "PROMOTED",
              started_at:
                "2026-08-30T18:48:00.000Z",
              completed_at:
                "2026-08-30T18:51:00.000Z",
            },
          ],
        };
      }

      if (sql.includes("FROM canary_observations")) {
        return {
          rows: [
            {
              observation_id:
                "523e4567-e89b-42d3-a456-426614174000",
              deployment_attempt_id:
                attemptId,
              observed_at:
                "2026-08-30T18:50:00.000Z",
              traffic_percent: 5,
              health_status: "HEALTHY",
              error_rate_threshold_passed: true,
              latency_threshold_passed: true,
              sample_size: 200,
            },
          ],
        };
      }

      if (sql.includes("FROM audit_events")) {
        return {
          rows: [
            {
              event_type:
                "DEPLOYMENT_PROMOTED",
              actor_type: "SYSTEM",
              occurred_at:
                "2026-08-30T18:51:00.000Z",
            },
          ],
        };
      }

      return {
        rows: [],
      };
    },
  );

  const result =
    await new PostgresManagementReportStore(
      pool,
    ).getRelease({
      repositoryOwner: "RWAMBA",
      repositoryName:
        "the-autonomous-canary",
      releaseId,
    });

  assert.equal(
    result.workflowRuns.items[0]
      ?.workflowRunId,
    33_329_058_711,
  );
  assert.equal(
    result.deploymentAttempts.items[0]
      ?.observations[0]?.healthStatus,
    "HEALTHY",
  );
  assert.deepEqual(
    result.deterministicFindings.items[0]
      ?.evidenceAttribution,
    {
      source: "TRIVY",
      sourceVersion: "1.0.0",
      identifier: "CVE-2026-1000",
      category:
        "DEPENDENCY_VULNERABILITY",
      generatedAt:
        "2026-08-30T18:47:59.000Z",
    },
  );
  assert.deepEqual(
    result.auditEvents.items[0],
    {
      eventType: "DEPLOYMENT_PROMOTED",
      actorType: "SYSTEM",
      occurredAt:
        "2026-08-30T18:51:00.000Z",
    },
  );
  assert.equal(
    statements.some((sql) =>
      /SELECT[^;]*metadata/iu.test(sql)),
    false,
  );
});

test("marks every repeated management detail section when its boundary is exceeded", async () => {
  const attemptIds = Array.from(
    {
      length:
        maximumManagementDeploymentAttempts
        + 1,
    },
    (_, index) =>
      `00000000-0000-4000-8000-${(
        index + 1
      ).toString(16).padStart(12, "0")}`,
  );
  const firstAttemptId = attemptIds[0];

  assert.ok(firstAttemptId);

  const pool = createPool(
    async (text) => {
      const sql = normalizeSql(text);

      if (sql.includes("FROM repositories")) {
        return {
          rows: [
            {
              repository_id: "101",
              owner: "RWAMBA",
              name:
                "the-autonomous-canary",
            },
          ],
        };
      }

      if (sql.includes("FROM releases AS r")) {
        return {
          rows: [
            releaseRow(),
          ],
        };
      }

      if (sql.includes("FROM workflow_runs")) {
        return {
          rows: Array.from(
            {
              length:
                maximumManagementWorkflowRuns
                + 1,
            },
            (_, index) => ({
              workflow_run_id: String(
                index + 1,
              ),
              run_attempt: 1,
              workflow_name:
                "Continuous Integration",
              head_sha:
                "ae222bdc592e3721fc9024a02b20759e25cdb3f9",
              conclusion: "success",
              created_at:
                "2026-08-30T18:47:13.000Z",
              updated_at:
                "2026-08-30T18:50:00.000Z",
            }),
          ),
        };
      }

      if (
        sql.includes(
          "FROM deterministic_findings",
        )
      ) {
        return {
          rows: Array.from(
            {
              length:
                maximumManagementFindings
                + 1,
            },
            () => ({
              code: "CI_INCOMPLETE",
              severity: "HIGH",
              title:
                "CI evidence is incomplete",
              explanation:
                "A required workflow result was unavailable.",
              file_path: null,
              blocking: false,
              created_at:
                "2026-08-30T18:48:00.000Z",
            }),
          ),
        };
      }

      if (sql.includes("FROM deployment_attempts")) {
        return {
          rows: attemptIds.map(
            (deploymentAttemptId) => ({
              deployment_attempt_id:
                deploymentAttemptId,
              provider: "DOCKER_COMPOSE",
              external_deployment_id: null,
              strategy: "CANARY",
              initial_traffic_percent: 5,
              status: "PROMOTED",
              started_at:
                "2026-08-30T18:48:00.000Z",
              completed_at:
                "2026-08-30T18:51:00.000Z",
            }),
          ),
        };
      }

      if (sql.includes("FROM canary_observations")) {
        return {
          rows: Array.from(
            {
              length:
                maximumManagementObservationsPerAttempt
                + 1,
            },
            (_, index) => ({
              observation_id:
                `10000000-0000-4000-8000-${(
                  index + 1
                ).toString(16).padStart(12, "0")}`,
              deployment_attempt_id:
                firstAttemptId,
              observed_at:
                "2026-08-30T18:50:00.000Z",
              traffic_percent: 5,
              health_status: "HEALTHY",
              error_rate_threshold_passed: true,
              latency_threshold_passed: true,
              sample_size: 200,
            }),
          ),
        };
      }

      if (sql.includes("FROM audit_events")) {
        return {
          rows: Array.from(
            {
              length:
                maximumManagementAuditEvents
                + 1,
            },
            () => ({
              event_type:
                "DEPLOYMENT_PROMOTED",
              actor_type: "SYSTEM",
              occurred_at:
                "2026-08-30T18:51:00.000Z",
            }),
          ),
        };
      }

      return {
        rows: [],
      };
    },
  );

  const result =
    await new PostgresManagementReportStore(
      pool,
    ).getRelease({
      repositoryOwner: "RWAMBA",
      repositoryName:
        "the-autonomous-canary",
      releaseId,
    });

  assert.equal(
    result.workflowRuns.items.length,
    maximumManagementWorkflowRuns,
  );
  assert.equal(
    result.workflowRuns.truncated,
    true,
  );
  assert.equal(
    result.deterministicFindings.items.length,
    maximumManagementFindings,
  );
  assert.equal(
    result.deterministicFindings.truncated,
    true,
  );
  assert.equal(
    result.deploymentAttempts.items.length,
    maximumManagementDeploymentAttempts,
  );
  assert.equal(
    result.deploymentAttempts.truncated,
    true,
  );
  assert.equal(
    result.deploymentAttempts.items[0]
      ?.observations.length,
    maximumManagementObservationsPerAttempt,
  );
  assert.equal(
    result.deploymentAttempts.items[0]
      ?.observationsTruncated,
    true,
  );
  assert.equal(
    result.auditEvents.items.length,
    maximumManagementAuditEvents,
  );
  assert.equal(
    result.auditEvents.truncated,
    true,
  );
});

test("rejects an unknown repository before release queries", async () => {
  const statements: string[] = [];
  const pool = createPool(async (text) => {
    statements.push(normalizeSql(text));
    return {
      rows: [],
    };
  });

  await assert.rejects(
    new PostgresManagementReportStore(
      pool,
    ).listReleases({
      repositoryOwner: "missing",
      repositoryName: "repository",
      limit: 25,
    }),
    (error: unknown) =>
      isHttpError(error)
      && error.code
        === "MANAGEMENT_REPOSITORY_NOT_FOUND",
  );

  assert.deepEqual(statements, [
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    "SELECT repository_id::text, owner, name FROM repositories WHERE lower(owner) = lower($1) AND lower(name) = lower($2)",
    "ROLLBACK",
  ]);
});

test("does not expose a release through a mismatched repository scope", async () => {
  const pool = createPool(
    async (text) => {
      const sql = normalizeSql(text);

      if (sql.includes("FROM repositories")) {
        return {
          rows: [
            {
              repository_id: "202",
              owner: "OTHER",
              name: "repository",
            },
          ],
        };
      }

      return {
        rows: [],
      };
    },
  );

  await assert.rejects(
    new PostgresManagementReportStore(
      pool,
    ).getRelease({
      repositoryOwner: "OTHER",
      repositoryName: "repository",
      releaseId,
    }),
    (error: unknown) =>
      isHttpError(error)
      && error.code
        === "MANAGEMENT_RELEASE_NOT_FOUND",
  );
});

test("rolls back a failed management report transaction", async () => {
  const statements: string[] = [];
  const pool = createPool(
    async (text) => {
      const sql = normalizeSql(text);
      statements.push(sql);

      if (sql.includes("FROM repositories")) {
        throw new Error(
          "database unavailable",
        );
      }

      return {
        rows: [],
      };
    },
  );

  await assert.rejects(
    new PostgresManagementReportStore(
      pool,
    ).listReleases({
      repositoryOwner: "RWAMBA",
      repositoryName: "canary",
      limit: 25,
    }),
    /database unavailable/u,
  );

  assert.equal(
    statements.at(-1),
    "ROLLBACK",
  );
});
