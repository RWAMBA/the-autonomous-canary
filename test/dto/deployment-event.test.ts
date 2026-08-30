import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  parseDeploymentEvent,
  parseDeploymentEventReceipt,
} from "../../src/dto/deployment-event.js";

const releaseId =
  "123e4567-e89b-42d3-a456-426614174000";
const attemptId =
  "223e4567-e89b-42d3-a456-426614174000";
const eventId =
  "323e4567-e89b-42d3-a456-426614174000";

test("parses a policy-aligned deployment start", () => {
  const event = parseDeploymentEvent({
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

  assert.equal(
    event.eventType,
    "DEPLOYMENT_STARTED",
  );
});

test("requires standard deployments to begin at full traffic", () => {
  assert.throws(
    () => parseDeploymentEvent({
      eventId,
      eventType: "DEPLOYMENT_STARTED",
      releaseId,
      deploymentAttemptId: attemptId,
      occurredAt:
        "2026-08-30T15:32:42.000Z",
      provider: "RENDER",
      strategy: "STANDARD",
      initialTrafficPercent: 50,
    }),
    {
      name: "ZodError",
    },
  );
});

test("parses bounded canary health evidence", () => {
  const event = parseDeploymentEvent({
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
  });

  assert.equal(
    event.eventType,
    "CANARY_OBSERVED",
  );
});

test("rejects incomplete observation evidence", () => {
  assert.throws(
    () => parseDeploymentEvent({
      eventId,
      eventType: "CANARY_OBSERVED",
      releaseId,
      deploymentAttemptId: attemptId,
      occurredAt:
        "2026-08-30T15:34:00.000Z",
      trafficPercent: 5,
      healthStatus: "HEALTHY",
    }),
    {
      name: "ZodError",
    },
  );
});

test("requires attempted outcomes to carry an attempt identity", () => {
  assert.throws(
    () => parseDeploymentEvent({
      eventId,
      eventType:
        "DEPLOYMENT_OUTCOME_RECORDED",
      releaseId,
      occurredAt:
        "2026-08-30T15:35:00.000Z",
      outcome: "PROMOTED",
    }),
    {
      name: "ZodError",
    },
  );
});

test("forbids an attempt identity on a blocked outcome", () => {
  assert.throws(
    () => parseDeploymentEvent({
      eventId,
      eventType:
        "DEPLOYMENT_OUTCOME_RECORDED",
      releaseId,
      deploymentAttemptId: attemptId,
      occurredAt:
        "2026-08-30T15:35:00.000Z",
      outcome: "BLOCKED",
    }),
    {
      name: "ZodError",
    },
  );
});

test("rejects unknown deployment event fields", () => {
  assert.throws(
    () => parseDeploymentEvent({
      eventId,
      eventType: "DEPLOYMENT_STARTED",
      releaseId,
      deploymentAttemptId: attemptId,
      occurredAt:
        "2026-08-30T15:32:42.000Z",
      provider: "RENDER",
      strategy: "CANARY",
      initialTrafficPercent: 5,
      rawDeploymentLog:
        "must never be accepted",
    }),
    {
      name: "ZodError",
    },
  );
});

test("parses a complete prediction comparison receipt", () => {
  const receipt =
    parseDeploymentEventReceipt({
      eventId,
      eventType:
        "DEPLOYMENT_OUTCOME_RECORDED",
      releaseId,
      deploymentAttemptId: attemptId,
      replayed: false,
      releaseStatus: "COMPLETED",
      deploymentStatus: "ROLLED_BACK",
      predictionComparison: {
        riskScore: 80,
        riskLevel: "HIGH",
        recommendedStrategy: "CANARY",
        actualOutcome: "ROLLED_BACK",
        directionallyCorrect: true,
      },
    });

  assert.equal(
    receipt.predictionComparison
      ?.directionallyCorrect,
    true,
  );
});
