import {
  createHash,
} from "node:crypto";

import type {
  Pool,
  PoolClient,
  QueryResultRow,
} from "pg";

import type {
  DeploymentAttemptStatus,
  DeploymentEventDto,
  DeploymentEventReceiptDto,
  DeploymentOutcome,
  PredictionComparison,
  ReleaseLifecycleStatus,
} from "../dto/deployment-event.js";
import {
  HttpError,
} from "../middleware/http-error.js";

interface ReleaseContextRow
extends QueryResultRow {
  readonly release_id: string;
  readonly release_status:
    ReleaseLifecycleStatus;
  readonly policy_decision:
    "CONTINUE" | "BLOCK" | null;
  readonly deployment_strategy:
    "BLOCKED" | "CANARY" | "STANDARD"
    | null;
  readonly initial_traffic_percent:
    number | null;
  readonly risk_score: number | null;
  readonly risk_level:
    "LOW" | "MEDIUM" | "HIGH"
    | "CRITICAL" | null;
  readonly recommended_strategy:
    "BLOCKED" | "CANARY" | "STANDARD"
    | null;
}

interface DeploymentAttemptRow
extends QueryResultRow {
  readonly deployment_attempt_id: string;
  readonly release_id: string;
  readonly strategy:
    "CANARY" | "STANDARD";
  readonly status:
    DeploymentAttemptStatus;
  readonly started_at: Date | string;
  readonly completed_at:
    Date | string | null;
}

interface DeploymentEventReceiptRow
extends QueryResultRow {
  readonly release_id: string;
  readonly event_type:
    DeploymentEventDto["eventType"];
  readonly payload_sha256: string;
}

interface ReleaseOutcomeRow
extends QueryResultRow {
  readonly outcome_id: string;
  readonly deployment_attempt_id:
    string | null;
  readonly outcome: DeploymentOutcome;
  readonly recorded_at: Date | string;
}

interface LatestObservationRow
extends QueryResultRow {
  readonly latest_observed_at:
    Date | string | null;
}

function conflict(
  code: string,
  message: string,
): HttpError {
  return new HttpError({
    statusCode: 409,
    code,
    message,
  });
}

function isUniqueViolation(
  error: unknown,
): boolean {
  return error instanceof Error
    && "code" in error
    && error.code === "23505";
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

function eventAttemptId(
  event: DeploymentEventDto,
): string | undefined {
  return "deploymentAttemptId" in event
    ? event.deploymentAttemptId
    : undefined;
}

function payloadSha256(
  event: DeploymentEventDto,
): string {
  return createHash("sha256")
    .update(JSON.stringify(event))
    .digest("hex");
}

function toTime(
  value: Date | string,
): number {
  return value instanceof Date
    ? value.getTime()
    : Date.parse(value);
}

function assertReviewRecorded(
  release: ReleaseContextRow,
): asserts release is ReleaseContextRow & {
  readonly policy_decision:
    "CONTINUE" | "BLOCK";
  readonly deployment_strategy:
    "BLOCKED" | "CANARY" | "STANDARD";
  readonly initial_traffic_percent: number;
  readonly risk_score: number;
  readonly risk_level:
    "LOW" | "MEDIUM" | "HIGH"
    | "CRITICAL";
  readonly recommended_strategy:
    "BLOCKED" | "CANARY" | "STANDARD";
} {
  if (
    release.policy_decision === null
    || release.deployment_strategy === null
    || release.initial_traffic_percent === null
    || release.risk_score === null
    || release.risk_level === null
    || release.recommended_strategy === null
  ) {
    throw conflict(
      "RELEASE_REVIEW_REQUIRED",
      "A persisted release review is required before deployment events can be recorded.",
    );
  }
}

async function lockRelease(
  client: PoolClient,
  releaseId: string,
): Promise<ReleaseContextRow> {
  const result =
    await client.query<ReleaseContextRow>(
      `SELECT
         r.release_id,
         r.status AS release_status,
         p.decision AS policy_decision,
         p.deployment_strategy,
         p.initial_traffic_percent,
         prediction.risk_score,
         prediction.risk_level,
         prediction.recommended_strategy
       FROM releases AS r
       LEFT JOIN policy_decisions AS p
         USING (release_id)
       LEFT JOIN review_predictions
         AS prediction USING (release_id)
       WHERE r.release_id = $1
       FOR UPDATE OF r`,
      [
        releaseId,
      ],
    );

  const release = result.rows[0];

  if (release === undefined) {
    throw new HttpError({
      statusCode: 404,
      code: "RELEASE_NOT_FOUND",
      message:
        "The correlated release was not found.",
    });
  }

  return release;
}

async function findAttempt(
  client: PoolClient,
  deploymentAttemptId: string,
): Promise<DeploymentAttemptRow | undefined> {
  const result =
    await client.query<DeploymentAttemptRow>(
      `SELECT
         deployment_attempt_id,
         release_id,
         strategy,
         status,
         started_at,
         completed_at
       FROM deployment_attempts
       WHERE deployment_attempt_id = $1
       FOR UPDATE`,
      [
        deploymentAttemptId,
      ],
    );

  return result.rows[0];
}

async function requireBoundAttempt(
  client: PoolClient,
  event: DeploymentEventDto & {
    readonly deploymentAttemptId: string;
  },
): Promise<DeploymentAttemptRow> {
  const attempt = await findAttempt(
    client,
    event.deploymentAttemptId,
  );

  if (attempt === undefined) {
    throw new HttpError({
      statusCode: 404,
      code:
        "DEPLOYMENT_ATTEMPT_NOT_FOUND",
      message:
        "The correlated deployment attempt was not found.",
    });
  }

  if (attempt.release_id !== event.releaseId) {
    throw conflict(
      "DEPLOYMENT_ATTEMPT_RELEASE_MISMATCH",
      "The deployment attempt does not belong to the correlated release.",
    );
  }

  return attempt;
}

function assertActiveAttempt(
  attempt: DeploymentAttemptRow,
): void {
  if (
    attempt.status !== "STARTED"
    && attempt.status !== "OBSERVING"
  ) {
    throw conflict(
      "DEPLOYMENT_STATE_CONFLICT",
      "The deployment attempt is no longer active.",
    );
  }
}

async function assertChronology(
  client: PoolClient,
  event: DeploymentEventDto & {
    readonly deploymentAttemptId: string;
  },
  attempt: DeploymentAttemptRow,
): Promise<void> {
  const eventTime = Date.parse(
    event.occurredAt,
  );

  if (eventTime < toTime(attempt.started_at)) {
    throw conflict(
      "DEPLOYMENT_EVENT_TIME_CONFLICT",
      "The deployment event cannot precede the deployment start.",
    );
  }

  const observationResult =
    await client.query<LatestObservationRow>(
      `SELECT max(observed_at)
         AS latest_observed_at
       FROM canary_observations
       WHERE deployment_attempt_id = $1`,
      [
        event.deploymentAttemptId,
      ],
    );

  const latestObservedAt =
    observationResult.rows[0]
      ?.latest_observed_at;

  if (
    latestObservedAt !== null
    && latestObservedAt !== undefined
    && eventTime < toTime(latestObservedAt)
  ) {
    throw conflict(
      "DEPLOYMENT_EVENT_TIME_CONFLICT",
      "The deployment event cannot precede the latest canary observation.",
    );
  }
}

export function evaluatePredictionDirection(
  prediction: {
    readonly riskScore: number;
    readonly riskLevel:
      "LOW" | "MEDIUM" | "HIGH"
      | "CRITICAL";
    readonly recommendedStrategy:
      "BLOCKED" | "CANARY" | "STANDARD";
  },
  actualOutcome: DeploymentOutcome,
): PredictionComparison {
  const predictedAdverse =
    prediction.riskLevel === "HIGH"
    || prediction.riskLevel === "CRITICAL"
    || prediction.recommendedStrategy
      === "BLOCKED";

  const actualAdverse =
    actualOutcome === "BLOCKED"
    || actualOutcome === "ROLLED_BACK"
    || actualOutcome === "FAILED";

  return {
    ...prediction,
    actualOutcome,
    directionallyCorrect:
      predictedAdverse === actualAdverse,
  };
}

function comparisonFor(
  release: ReleaseContextRow & {
    readonly risk_score: number;
    readonly risk_level:
      "LOW" | "MEDIUM" | "HIGH"
      | "CRITICAL";
    readonly recommended_strategy:
      "BLOCKED" | "CANARY" | "STANDARD";
  },
  outcome: DeploymentOutcome,
): PredictionComparison {
  return evaluatePredictionDirection(
    {
      riskScore: release.risk_score,
      riskLevel: release.risk_level,
      recommendedStrategy:
        release.recommended_strategy,
    },
    outcome,
  );
}

export function deploymentStateForOutcome(
  strategy: "CANARY" | "STANDARD",
  outcome: Exclude<
    DeploymentOutcome,
    "BLOCKED"
  >,
): {
  readonly releaseStatus:
    "DEPLOYING" | "COMPLETED";
  readonly deploymentStatus:
    DeploymentAttemptStatus;
  readonly completed: boolean;
} {
  if (
    strategy === "CANARY"
    && outcome === "CONTINUED"
  ) {
    return {
      releaseStatus: "DEPLOYING",
      deploymentStatus: "OBSERVING",
      completed: false,
    };
  }

  if (outcome === "CONTINUED") {
    return {
      releaseStatus: "COMPLETED",
      deploymentStatus: "PROMOTED",
      completed: true,
    };
  }

  return {
    releaseStatus: "COMPLETED",
    deploymentStatus: outcome,
    completed: true,
  };
}

async function findReceipt(
  client: PoolClient,
  eventId: string,
): Promise<
  DeploymentEventReceiptRow | undefined
> {
  const result =
    await client.query<
      DeploymentEventReceiptRow
    >(
      `SELECT
         release_id,
         event_type,
         payload_sha256
       FROM deployment_event_receipts
       WHERE event_id = $1`,
      [
        eventId,
      ],
    );

  return result.rows[0];
}

async function insertReceipt(
  client: PoolClient,
  event: DeploymentEventDto,
  hash: string,
): Promise<void> {
  await client.query(
    `INSERT INTO deployment_event_receipts (
       event_id,
       release_id,
       deployment_attempt_id,
       event_type,
       payload_sha256
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      event.eventId,
      event.releaseId,
      eventAttemptId(event) ?? null,
      event.eventType,
      hash,
    ],
  );
}

async function insertAuditEvent(
  client: PoolClient,
  event: DeploymentEventDto,
  metadata: Readonly<
    Record<string, unknown>
  >,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (
       release_id,
       event_type,
       actor_type,
       metadata,
       occurred_at
     ) VALUES ($1, $2, 'SYSTEM', $3::jsonb, $4)`,
    [
      event.releaseId,
      event.eventType,
      JSON.stringify({
        eventId: event.eventId,
        ...metadata,
      }),
      new Date(event.occurredAt),
    ],
  );
}

async function replayReceipt(
  client: PoolClient,
  event: DeploymentEventDto,
  release: ReleaseContextRow,
): Promise<DeploymentEventReceiptDto> {
  const deploymentAttemptId =
    eventAttemptId(event);
  const attempt =
    deploymentAttemptId === undefined
      ? undefined
      : await findAttempt(
          client,
          deploymentAttemptId,
        );

  assertReviewRecorded(release);

  return {
    eventId: event.eventId,
    eventType: event.eventType,
    releaseId: event.releaseId,
    ...(deploymentAttemptId === undefined
      ? {}
      : {
          deploymentAttemptId,
        }),
    replayed: true,
    releaseStatus:
      release.release_status,
    ...(attempt === undefined
      ? {}
      : {
          deploymentStatus:
            attempt.status,
        }),
    ...(event.eventType
      !== "DEPLOYMENT_OUTCOME_RECORDED"
      ? {}
      : {
          predictionComparison:
            comparisonFor(
              release,
              event.outcome,
            ),
        }),
  };
}

async function recordStarted(
  client: PoolClient,
  event: Extract<
    DeploymentEventDto,
    {
      readonly eventType:
        "DEPLOYMENT_STARTED";
    }
  >,
  release: ReleaseContextRow,
  hash: string,
): Promise<DeploymentEventReceiptDto> {
  assertReviewRecorded(release);

  if (
    release.policy_decision !== "CONTINUE"
    || release.deployment_strategy
      === "BLOCKED"
  ) {
    throw conflict(
      "DEPLOYMENT_POLICY_BLOCKED",
      "Hard-coded release policy does not permit this deployment.",
    );
  }

  if (
    event.strategy
      !== release.deployment_strategy
    || event.initialTrafficPercent
      !== release.initial_traffic_percent
  ) {
    throw conflict(
      "DEPLOYMENT_POLICY_MISMATCH",
      "The deployment does not match the persisted release policy.",
    );
  }

  if (
    release.release_status !== "REVIEWED"
    && release.release_status !== "COMPLETED"
  ) {
    throw conflict(
      "DEPLOYMENT_STATE_CONFLICT",
      "The release is not ready to start a deployment.",
    );
  }

  const existingAttempt = await findAttempt(
    client,
    event.deploymentAttemptId,
  );

  if (existingAttempt !== undefined) {
    throw conflict(
      "DEPLOYMENT_ATTEMPT_REPLAYED",
      "The deployment attempt identifier has already been used.",
    );
  }

  const activeAttemptResult =
    await client.query<DeploymentAttemptRow>(
      `SELECT
         deployment_attempt_id,
         release_id,
         strategy,
         status,
         started_at,
         completed_at
       FROM deployment_attempts
       WHERE release_id = $1
         AND status IN (
           'STARTED',
           'OBSERVING'
         )
       ORDER BY started_at DESC
       LIMIT 1
       FOR UPDATE`,
      [
        event.releaseId,
      ],
    );

  if (activeAttemptResult.rows[0]) {
    throw conflict(
      "DEPLOYMENT_STATE_CONFLICT",
      "The release already has an active deployment attempt.",
    );
  }

  if (release.release_status === "COMPLETED") {
    const outcomeResult =
      await client.query<ReleaseOutcomeRow>(
        `SELECT
           outcome_id,
           deployment_attempt_id,
           outcome,
           recorded_at
         FROM release_outcomes
         WHERE release_id = $1
         FOR UPDATE`,
        [
          event.releaseId,
        ],
      );
    const priorOutcome =
      outcomeResult.rows[0]?.outcome;

    if (
      priorOutcome !== "ROLLED_BACK"
      && priorOutcome !== "FAILED"
    ) {
      throw conflict(
        "DEPLOYMENT_STATE_CONFLICT",
        "Only a rolled-back or failed release may start another deployment attempt.",
      );
    }
  }

  await client.query(
    `INSERT INTO deployment_attempts (
       deployment_attempt_id,
       release_id,
       provider,
       external_deployment_id,
       strategy,
       initial_traffic_percent,
       status,
       started_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       'STARTED', $7
     )`,
    [
      event.deploymentAttemptId,
      event.releaseId,
      event.provider,
      event.externalDeploymentId ?? null,
      event.strategy,
      event.initialTrafficPercent,
      new Date(event.occurredAt),
    ],
  );

  await client.query(
    `UPDATE releases
     SET status = 'DEPLOYING',
         updated_at = now()
     WHERE release_id = $1`,
    [
      event.releaseId,
    ],
  );

  await insertAuditEvent(
    client,
    event,
    {
      deploymentAttemptId:
        event.deploymentAttemptId,
      provider: event.provider,
      strategy: event.strategy,
      initialTrafficPercent:
        event.initialTrafficPercent,
    },
  );
  await insertReceipt(client, event, hash);

  return {
    eventId: event.eventId,
    eventType: event.eventType,
    releaseId: event.releaseId,
    deploymentAttemptId:
      event.deploymentAttemptId,
    replayed: false,
    releaseStatus: "DEPLOYING",
    deploymentStatus: "STARTED",
  };
}

async function recordObservation(
  client: PoolClient,
  event: Extract<
    DeploymentEventDto,
    {
      readonly eventType:
        "CANARY_OBSERVED";
    }
  >,
  release: ReleaseContextRow,
  hash: string,
): Promise<DeploymentEventReceiptDto> {
  assertReviewRecorded(release);

  if (release.release_status !== "DEPLOYING") {
    throw conflict(
      "DEPLOYMENT_STATE_CONFLICT",
      "The release is not in an active deployment state.",
    );
  }

  const attempt = await requireBoundAttempt(
    client,
    event,
  );
  assertActiveAttempt(attempt);

  if (attempt.strategy !== "CANARY") {
    throw conflict(
      "DEPLOYMENT_STRATEGY_CONFLICT",
      "Canary observations require a canary deployment attempt.",
    );
  }

  await assertChronology(
    client,
    event,
    attempt,
  );

  await client.query(
    `INSERT INTO canary_observations (
       observation_id,
       release_id,
       deployment_attempt_id,
       observed_at,
       traffic_percent,
       health_status,
       error_rate_threshold_passed,
       latency_threshold_passed,
       sample_size
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9
     )`,
    [
      event.eventId,
      event.releaseId,
      event.deploymentAttemptId,
      new Date(event.occurredAt),
      event.trafficPercent,
      event.healthStatus,
      event.errorRateThresholdPassed,
      event.latencyThresholdPassed,
      event.sampleSize ?? null,
    ],
  );

  await client.query(
    `UPDATE deployment_attempts
     SET status = 'OBSERVING'
     WHERE deployment_attempt_id = $1`,
    [
      event.deploymentAttemptId,
    ],
  );

  await insertAuditEvent(
    client,
    event,
    {
      deploymentAttemptId:
        event.deploymentAttemptId,
      trafficPercent:
        event.trafficPercent,
      healthStatus:
        event.healthStatus,
      errorRateThresholdPassed:
        event.errorRateThresholdPassed,
      latencyThresholdPassed:
        event.latencyThresholdPassed,
      sampleSize:
        event.sampleSize ?? null,
    },
  );
  await insertReceipt(client, event, hash);

  return {
    eventId: event.eventId,
    eventType: event.eventType,
    releaseId: event.releaseId,
    deploymentAttemptId:
      event.deploymentAttemptId,
    replayed: false,
    releaseStatus: "DEPLOYING",
    deploymentStatus: "OBSERVING",
  };
}

async function upsertOutcome(
  client: PoolClient,
  event: Extract<
    DeploymentEventDto,
    {
      readonly eventType:
        "DEPLOYMENT_OUTCOME_RECORDED";
    }
  >,
  deploymentAttemptId: string | undefined,
  comparison: PredictionComparison,
): Promise<void> {
  const result =
    await client.query<ReleaseOutcomeRow>(
      `SELECT
         outcome_id,
         deployment_attempt_id,
         outcome,
         recorded_at
       FROM release_outcomes
       WHERE release_id = $1
       FOR UPDATE`,
      [
        event.releaseId,
      ],
    );

  const current = result.rows[0];

  if (current === undefined) {
    await client.query(
      `INSERT INTO release_outcomes (
         outcome_id,
         release_id,
         deployment_attempt_id,
         outcome,
         prediction_directionally_correct,
         recorded_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.eventId,
        event.releaseId,
        deploymentAttemptId ?? null,
        event.outcome,
        comparison.directionallyCorrect,
        new Date(event.occurredAt),
      ],
    );
    return;
  }

  if (
    current.recorded_at !== undefined
    && Date.parse(event.occurredAt)
      < toTime(current.recorded_at)
  ) {
    throw conflict(
      "DEPLOYMENT_EVENT_TIME_CONFLICT",
      "The deployment outcome cannot precede the currently recorded outcome.",
    );
  }

  if (
    current.deployment_attempt_id
      === deploymentAttemptId
    && current.outcome !== "CONTINUED"
  ) {
    throw conflict(
      "DEPLOYMENT_STATE_CONFLICT",
      "The release already has a terminal outcome for this deployment attempt.",
    );
  }

  await client.query(
    `UPDATE release_outcomes
     SET deployment_attempt_id = $2,
         outcome = $3,
         prediction_directionally_correct = $4,
         recorded_at = $5
     WHERE release_id = $1`,
    [
      event.releaseId,
      deploymentAttemptId ?? null,
      event.outcome,
      comparison.directionallyCorrect,
      new Date(event.occurredAt),
    ],
  );
}

async function recordBlockedOutcome(
  client: PoolClient,
  event: Extract<
    DeploymentEventDto,
    {
      readonly eventType:
        "DEPLOYMENT_OUTCOME_RECORDED";
      readonly outcome: "BLOCKED";
    }
  >,
  release: ReleaseContextRow,
  hash: string,
): Promise<DeploymentEventReceiptDto> {
  assertReviewRecorded(release);

  if (
    release.policy_decision !== "BLOCK"
    || release.deployment_strategy
      !== "BLOCKED"
  ) {
    throw conflict(
      "DEPLOYMENT_POLICY_MISMATCH",
      "A blocked outcome requires a persisted blocking policy decision.",
    );
  }

  if (release.release_status !== "REVIEWED") {
    throw conflict(
      "DEPLOYMENT_STATE_CONFLICT",
      "The blocked release is not awaiting an outcome.",
    );
  }

  const comparison = comparisonFor(
    release,
    event.outcome,
  );

  await upsertOutcome(
    client,
    event,
    undefined,
    comparison,
  );
  await client.query(
    `UPDATE releases
     SET status = 'COMPLETED',
         updated_at = now()
     WHERE release_id = $1`,
    [
      event.releaseId,
    ],
  );
  await insertAuditEvent(
    client,
    event,
    {
      outcome: event.outcome,
      predictionDirectionallyCorrect:
        comparison.directionallyCorrect,
    },
  );
  await insertReceipt(client, event, hash);

  return {
    eventId: event.eventId,
    eventType: event.eventType,
    releaseId: event.releaseId,
    replayed: false,
    releaseStatus: "COMPLETED",
    predictionComparison: comparison,
  };
}

async function recordAttemptedOutcome(
  client: PoolClient,
  event: Extract<
    DeploymentEventDto,
    {
      readonly eventType:
        "DEPLOYMENT_OUTCOME_RECORDED";
      readonly deploymentAttemptId: string;
    }
  >,
  release: ReleaseContextRow,
  hash: string,
): Promise<DeploymentEventReceiptDto> {
  assertReviewRecorded(release);

  if (release.policy_decision !== "CONTINUE") {
    throw conflict(
      "DEPLOYMENT_POLICY_BLOCKED",
      "Hard-coded release policy does not permit a deployment outcome.",
    );
  }

  if (release.release_status !== "DEPLOYING") {
    throw conflict(
      "DEPLOYMENT_STATE_CONFLICT",
      "The release is not in an active deployment state.",
    );
  }

  const attempt = await requireBoundAttempt(
    client,
    event,
  );
  assertActiveAttempt(attempt);
  await assertChronology(
    client,
    event,
    attempt,
  );

  if (
    attempt.strategy === "STANDARD"
    && event.outcome !== "CONTINUED"
    && event.outcome !== "FAILED"
  ) {
    throw conflict(
      "DEPLOYMENT_STRATEGY_CONFLICT",
      "A standard deployment may only continue or fail.",
    );
  }

  const comparison = comparisonFor(
    release,
    event.outcome,
  );
  const state = deploymentStateForOutcome(
    attempt.strategy,
    event.outcome,
  );

  await upsertOutcome(
    client,
    event,
    event.deploymentAttemptId,
    comparison,
  );
  await client.query(
    `UPDATE deployment_attempts
     SET status = $2,
         completed_at = $3
     WHERE deployment_attempt_id = $1`,
    [
      event.deploymentAttemptId,
      state.deploymentStatus,
      state.completed
        ? new Date(event.occurredAt)
        : null,
    ],
  );
  await client.query(
    `UPDATE releases
     SET status = $2,
         updated_at = now()
     WHERE release_id = $1`,
    [
      event.releaseId,
      state.releaseStatus,
    ],
  );
  await insertAuditEvent(
    client,
    event,
    {
      deploymentAttemptId:
        event.deploymentAttemptId,
      outcome: event.outcome,
      predictionDirectionallyCorrect:
        comparison.directionallyCorrect,
    },
  );
  await insertReceipt(client, event, hash);

  return {
    eventId: event.eventId,
    eventType: event.eventType,
    releaseId: event.releaseId,
    deploymentAttemptId:
      event.deploymentAttemptId,
    replayed: false,
    releaseStatus: state.releaseStatus,
    deploymentStatus:
      state.deploymentStatus,
    predictionComparison: comparison,
  };
}

export async function recordPostgresDeploymentEvent(
  pool: Pool,
  event: DeploymentEventDto,
): Promise<DeploymentEventReceiptDto> {
  const hash = payloadSha256(event);

  try {
    return await transaction(
      pool,
      async (client) => {
        const release = await lockRelease(
          client,
          event.releaseId,
        );
        const receipt = await findReceipt(
          client,
          event.eventId,
        );

        if (receipt !== undefined) {
          if (
            receipt.release_id
              !== event.releaseId
            || receipt.event_type
              !== event.eventType
            || receipt.payload_sha256 !== hash
          ) {
            throw conflict(
              "DEPLOYMENT_EVENT_REPLAYED",
              "The deployment event identifier has already been used for different content.",
            );
          }

          return replayReceipt(
            client,
            event,
            release,
          );
        }

        switch (event.eventType) {
          case "DEPLOYMENT_STARTED":
            return recordStarted(
              client,
              event,
              release,
              hash,
            );

          case "CANARY_OBSERVED":
            return recordObservation(
              client,
              event,
              release,
              hash,
            );

          case "DEPLOYMENT_OUTCOME_RECORDED":
            return "deploymentAttemptId"
              in event
              ? recordAttemptedOutcome(
                  client,
                  event,
                  release,
                  hash,
                )
              : recordBlockedOutcome(
                  client,
                  event,
                  release,
                  hash,
                );
        }
      },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(
        "DEPLOYMENT_EVENT_REPLAYED",
        "The deployment event or record identifier has already been used.",
      );
    }

    throw error;
  }
}
