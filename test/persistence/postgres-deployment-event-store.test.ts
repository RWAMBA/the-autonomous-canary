import assert from "node:assert/strict";
import {
  createHash,
} from "node:crypto";
import {
  test,
} from "node:test";

import type {
  Pool,
} from "pg";

import {
  parseDeploymentEvent,
} from "../../src/dto/deployment-event.js";
import type {
  DeploymentEventDto,
} from "../../src/dto/deployment-event.js";
import {
  isHttpError,
} from "../../src/middleware/http-error.js";
import {
  deploymentStateForOutcome,
  evaluatePredictionDirection,
  recordPostgresDeploymentEvent,
} from "../../src/persistence/postgres-deployment-event-store.js";

const releaseId =
  "123e4567-e89b-42d3-a456-426614174000";
const attemptId =
  "223e4567-e89b-42d3-a456-426614174000";
const eventId =
  "323e4567-e89b-42d3-a456-426614174000";

function normalizeSql(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function createPool(
  query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{
    readonly rows: readonly unknown[];
    readonly rowCount?: number;
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
  overrides: Readonly<
    Record<string, unknown>
  > = {},
) {
  return {
    release_id: releaseId,
    release_status: "REVIEWED",
    policy_decision: "CONTINUE",
    deployment_strategy: "CANARY",
    initial_traffic_percent: 5,
    risk_score: 80,
    risk_level: "HIGH",
    recommended_strategy: "CANARY",
    ...overrides,
  };
}

function startEvent(): DeploymentEventDto {
  return parseDeploymentEvent({
    eventId,
    eventType: "DEPLOYMENT_STARTED",
    releaseId,
    deploymentAttemptId: attemptId,
    occurredAt:
      "2026-08-30T15:32:42.000Z",
    provider: "RENDER",
    externalDeploymentId: "dep-101",
    strategy: "CANARY",
    initialTrafficPercent: 5,
  });
}

test("records a policy-aligned deployment start transactionally", async () => {
  const statements: Array<{
    readonly sql: string;
    readonly values:
      readonly unknown[] | undefined;
  }> = [];
  const pool = createPool(
    async (text, values) => {
      const sql = normalizeSql(text);
      statements.push({ sql, values });

      if (
        sql.includes("FROM releases AS r")
      ) {
        return {
          rows: [
            releaseRow(),
          ],
        };
      }

      return {
        rows: [],
      };
    },
  );

  const receipt =
    await recordPostgresDeploymentEvent(
      pool,
      startEvent(),
    );

  assert.deepEqual(receipt, {
    eventId,
    eventType: "DEPLOYMENT_STARTED",
    releaseId,
    deploymentAttemptId: attemptId,
    replayed: false,
    releaseStatus: "DEPLOYING",
    deploymentStatus: "STARTED",
  });
  assert.equal(statements[0]?.sql, "BEGIN");
  assert.equal(
    statements.at(-1)?.sql,
    "COMMIT",
  );
  assert.equal(
    statements.some(({ sql }) =>
      sql.startsWith(
        "INSERT INTO deployment_attempts",
      )),
    true,
  );
  assert.equal(
    statements.some(({ sql }) =>
      sql.startsWith(
        "INSERT INTO deployment_event_receipts",
      )),
    true,
  );
});

test("rejects deployment parameters that differ from hard-coded policy", async () => {
  const pool = createPool(
    async (text) => {
      const sql = normalizeSql(text);

      if (
        sql.includes("FROM releases AS r")
      ) {
        return {
          rows: [
            releaseRow({
              initial_traffic_percent: 10,
            }),
          ],
        };
      }

      return {
        rows: [],
      };
    },
  );

  await assert.rejects(
    recordPostgresDeploymentEvent(
      pool,
      startEvent(),
    ),
    (error: unknown) =>
      isHttpError(error)
      && error.statusCode === 409
      && error.code
        === "DEPLOYMENT_POLICY_MISMATCH",
  );
});

test("records bounded canary observations against an active matching attempt", async () => {
  const statements: string[] = [];
  const pool = createPool(
    async (text) => {
      const sql = normalizeSql(text);
      statements.push(sql);

      if (
        sql.includes("FROM releases AS r")
      ) {
        return {
          rows: [
            releaseRow({
              release_status: "DEPLOYING",
            }),
          ],
        };
      }

      if (
        sql.includes(
          "FROM deployment_attempts WHERE deployment_attempt_id",
        )
      ) {
        return {
          rows: [
            {
              deployment_attempt_id:
                attemptId,
              release_id: releaseId,
              strategy: "CANARY",
              status: "STARTED",
              started_at:
                "2026-08-30T15:32:42.000Z",
              completed_at: null,
            },
          ],
        };
      }

      if (sql.startsWith("SELECT max(")) {
        return {
          rows: [
            {
              latest_observed_at: null,
            },
          ],
        };
      }

      return {
        rows: [],
      };
    },
  );

  const receipt =
    await recordPostgresDeploymentEvent(
      pool,
      parseDeploymentEvent({
        eventId,
        eventType: "CANARY_OBSERVED",
        releaseId,
        deploymentAttemptId: attemptId,
        occurredAt:
          "2026-08-30T15:34:00.000Z",
        trafficPercent: 5,
        healthStatus: "HEALTHY",
        errorRateThresholdPassed: true,
        latencyThresholdPassed: true,
        sampleSize: 200,
      }),
    );

  assert.equal(
    receipt.deploymentStatus,
    "OBSERVING",
  );
  assert.equal(
    statements.some((sql) =>
      sql.startsWith(
        "INSERT INTO canary_observations",
      )),
    true,
  );
});

test("rejects an observation that predates its deployment", async () => {
  const pool = createPool(
    async (text) => {
      const sql = normalizeSql(text);

      if (
        sql.includes("FROM releases AS r")
      ) {
        return {
          rows: [
            releaseRow({
              release_status: "DEPLOYING",
            }),
          ],
        };
      }

      if (
        sql.includes(
          "FROM deployment_attempts WHERE deployment_attempt_id",
        )
      ) {
        return {
          rows: [
            {
              deployment_attempt_id:
                attemptId,
              release_id: releaseId,
              strategy: "CANARY",
              status: "STARTED",
              started_at:
                "2026-08-30T15:32:42.000Z",
              completed_at: null,
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
    recordPostgresDeploymentEvent(
      pool,
      parseDeploymentEvent({
        eventId,
        eventType: "CANARY_OBSERVED",
        releaseId,
        deploymentAttemptId: attemptId,
        occurredAt:
          "2026-08-30T15:30:00.000Z",
        trafficPercent: 5,
        healthStatus: "UNKNOWN",
        errorRateThresholdPassed: false,
        latencyThresholdPassed: false,
      }),
    ),
    (error: unknown) =>
      isHttpError(error)
      && error.code
        === "DEPLOYMENT_EVENT_TIME_CONFLICT",
  );
});

test("records a rollback and computes prediction accuracy server-side", async () => {
  let outcomeValues:
    readonly unknown[] | undefined;
  const pool = createPool(
    async (text, values) => {
      const sql = normalizeSql(text);

      if (
        sql.includes("FROM releases AS r")
      ) {
        return {
          rows: [
            releaseRow({
              release_status: "DEPLOYING",
            }),
          ],
        };
      }

      if (
        sql.includes(
          "FROM deployment_attempts WHERE deployment_attempt_id",
        )
      ) {
        return {
          rows: [
            {
              deployment_attempt_id:
                attemptId,
              release_id: releaseId,
              strategy: "CANARY",
              status: "OBSERVING",
              started_at:
                "2026-08-30T15:32:42.000Z",
              completed_at: null,
            },
          ],
        };
      }

      if (sql.startsWith("SELECT max(")) {
        return {
          rows: [
            {
              latest_observed_at:
                "2026-08-30T15:34:00.000Z",
            },
          ],
        };
      }

      if (
        sql.includes(
          "FROM release_outcomes",
        )
      ) {
        return {
          rows: [],
        };
      }

      if (
        sql.startsWith(
          "INSERT INTO release_outcomes",
        )
      ) {
        outcomeValues = values;
      }

      return {
        rows: [],
      };
    },
  );

  const receipt =
    await recordPostgresDeploymentEvent(
      pool,
      parseDeploymentEvent({
        eventId,
        eventType:
          "DEPLOYMENT_OUTCOME_RECORDED",
        releaseId,
        deploymentAttemptId: attemptId,
        occurredAt:
          "2026-08-30T15:35:00.000Z",
        outcome: "ROLLED_BACK",
      }),
    );

  assert.equal(
    receipt.predictionComparison
      ?.directionallyCorrect,
    true,
  );
  assert.equal(
    outcomeValues?.[4],
    true,
  );
  assert.equal(
    receipt.releaseStatus,
    "COMPLETED",
  );
  assert.equal(
    receipt.deploymentStatus,
    "ROLLED_BACK",
  );
});

test("records a blocked policy outcome without inventing a deployment attempt", async () => {
  let outcomeValues:
    readonly unknown[] | undefined;
  const pool = createPool(
    async (text, values) => {
      const sql = normalizeSql(text);

      if (
        sql.includes("FROM releases AS r")
      ) {
        return {
          rows: [
            releaseRow({
              policy_decision: "BLOCK",
              deployment_strategy: "BLOCKED",
              initial_traffic_percent: 0,
              risk_score: 95,
              risk_level: "CRITICAL",
              recommended_strategy: "BLOCKED",
            }),
          ],
        };
      }

      if (
        sql.includes(
          "FROM release_outcomes",
        )
      ) {
        return {
          rows: [],
        };
      }

      if (
        sql.startsWith(
          "INSERT INTO release_outcomes",
        )
      ) {
        outcomeValues = values;
      }

      return {
        rows: [],
      };
    },
  );

  const receipt =
    await recordPostgresDeploymentEvent(
      pool,
      parseDeploymentEvent({
        eventId,
        eventType:
          "DEPLOYMENT_OUTCOME_RECORDED",
        releaseId,
        occurredAt:
          "2026-08-30T15:35:00.000Z",
        outcome: "BLOCKED",
      }),
    );

  assert.equal(
    receipt.deploymentAttemptId,
    undefined,
  );
  assert.equal(
    receipt.predictionComparison
      ?.directionallyCorrect,
    true,
  );
  assert.equal(outcomeValues?.[2], null);
});

test("accepts an exact event replay without repeating mutations", async () => {
  const event = startEvent();
  const hash = createHash("sha256")
    .update(JSON.stringify(event))
    .digest("hex");
  const statements: string[] = [];
  const pool = createPool(
    async (text) => {
      const sql = normalizeSql(text);
      statements.push(sql);

      if (
        sql.includes("FROM releases AS r")
      ) {
        return {
          rows: [
            releaseRow({
              release_status: "DEPLOYING",
            }),
          ],
        };
      }

      if (
        sql.includes(
          "FROM deployment_event_receipts",
        )
      ) {
        return {
          rows: [
            {
              release_id: releaseId,
              event_type:
                "DEPLOYMENT_STARTED",
              payload_sha256: hash,
            },
          ],
        };
      }

      if (
        sql.includes(
          "FROM deployment_attempts WHERE deployment_attempt_id",
        )
      ) {
        return {
          rows: [
            {
              deployment_attempt_id:
                attemptId,
              release_id: releaseId,
              strategy: "CANARY",
              status: "OBSERVING",
              started_at:
                "2026-08-30T15:32:42.000Z",
              completed_at: null,
            },
          ],
        };
      }

      return {
        rows: [],
      };
    },
  );

  const receipt =
    await recordPostgresDeploymentEvent(
      pool,
      event,
    );

  assert.equal(receipt.replayed, true);
  assert.equal(
    receipt.deploymentStatus,
    "OBSERVING",
  );
  assert.equal(
    statements.some((sql) =>
      sql.startsWith("INSERT INTO")),
    false,
  );
});

test("rejects reuse of an event identity for different content", async () => {
  const pool = createPool(
    async (text) => {
      const sql = normalizeSql(text);

      if (
        sql.includes("FROM releases AS r")
      ) {
        return {
          rows: [
            releaseRow(),
          ],
        };
      }

      if (
        sql.includes(
          "FROM deployment_event_receipts",
        )
      ) {
        return {
          rows: [
            {
              release_id: releaseId,
              event_type:
                "DEPLOYMENT_STARTED",
              payload_sha256: "0".repeat(64),
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
    recordPostgresDeploymentEvent(
      pool,
      startEvent(),
    ),
    (error: unknown) =>
      isHttpError(error)
      && error.code
        === "DEPLOYMENT_EVENT_REPLAYED",
  );
});

test("measures adverse and non-adverse predictions without changing policy", () => {
  assert.equal(
    evaluatePredictionDirection(
      {
        riskScore: 80,
        riskLevel: "HIGH",
        recommendedStrategy: "CANARY",
      },
      "ROLLED_BACK",
    ).directionallyCorrect,
    true,
  );
  assert.equal(
    evaluatePredictionDirection(
      {
        riskScore: 80,
        riskLevel: "HIGH",
        recommendedStrategy: "CANARY",
      },
      "PROMOTED",
    ).directionallyCorrect,
    false,
  );
  assert.equal(
    evaluatePredictionDirection(
      {
        riskScore: 20,
        riskLevel: "LOW",
        recommendedStrategy: "STANDARD",
      },
      "CONTINUED",
    ).directionallyCorrect,
    true,
  );
});

test("maps continuation and terminal outcomes without executing rollout actions", () => {
  assert.deepEqual(
    deploymentStateForOutcome(
      "CANARY",
      "CONTINUED",
    ),
    {
      releaseStatus: "DEPLOYING",
      deploymentStatus: "OBSERVING",
      completed: false,
    },
  );
  assert.deepEqual(
    deploymentStateForOutcome(
      "CANARY",
      "PROMOTED",
    ),
    {
      releaseStatus: "COMPLETED",
      deploymentStatus: "PROMOTED",
      completed: true,
    },
  );
  assert.deepEqual(
    deploymentStateForOutcome(
      "STANDARD",
      "CONTINUED",
    ),
    {
      releaseStatus: "COMPLETED",
      deploymentStatus: "PROMOTED",
      completed: true,
    },
  );
});
