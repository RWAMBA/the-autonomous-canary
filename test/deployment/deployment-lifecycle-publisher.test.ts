import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import type {
  DeploymentEventDto,
} from "../../src/dto/deployment-event.js";
import type {
  HttpDeploymentEventPublisherConfig,
} from "../../src/deployment/deployment-event-publisher-config.js";
import {
  createDeploymentLifecyclePublisher,
} from "../../src/deployment/deployment-lifecycle-publisher.js";

const releaseId =
  "123e4567-e89b-42d3-a456-426614174000";
const deploymentAttemptId =
  "223e4567-e89b-42d3-a456-426614174000";

const config: HttpDeploymentEventPublisherConfig = {
  publisher: "HTTP",
  endpoint:
    "https://canaryguard.example/deployment-events",
  apiKey:
    "unit-test-review-api-key-000000000000",
  releaseId,
  deploymentAttemptId,
  deploymentProvider: "DOCKER_COMPOSE",
  externalDeploymentId: "compose-run-42",
  timeoutMs: 10_000,
  maxRetries: 0,
};

test("does not create an external publisher while disabled", () => {
  assert.equal(
    createDeploymentLifecyclePublisher({
      publisher: "DISABLED",
    }),
    undefined,
  );
});

test("publishes one correlated start, observation, and outcome sequence", async () => {
  const eventIds = [
    "323e4567-e89b-42d3-a456-426614174000",
    "423e4567-e89b-42d3-a456-426614174000",
    "523e4567-e89b-42d3-a456-426614174000",
  ];
  const occurredAt = [
    "2026-08-30T17:45:53.000Z",
    "2026-08-30T17:46:53.000Z",
    "2026-08-30T17:47:53.000Z",
  ];
  const events: DeploymentEventDto[] = [];

  const publisher =
    createDeploymentLifecyclePublisher(
      config,
      {
        createEventId: () => {
          const eventId = eventIds.shift();

          if (eventId === undefined) {
            throw new Error(
              "No prepared event identifier remains.",
            );
          }

          return eventId;
        },
        now: () => {
          const value = occurredAt.shift();

          if (value === undefined) {
            throw new Error(
              "No prepared timestamp remains.",
            );
          }

          return new Date(value);
        },
        request: async (_input, init) => {
          const event = JSON.parse(
            String(init?.body),
          ) as DeploymentEventDto;
          events.push(event);

          return new Response(
            JSON.stringify({
              eventId: event.eventId,
              eventType: event.eventType,
              releaseId: event.releaseId,
              deploymentAttemptId:
                "deploymentAttemptId" in event
                  ? event.deploymentAttemptId
                  : undefined,
              replayed: false,
              releaseStatus:
                event.eventType
                  === "DEPLOYMENT_OUTCOME_RECORDED"
                  ? "COMPLETED"
                  : "DEPLOYING",
              deploymentStatus:
                event.eventType
                  === "DEPLOYMENT_STARTED"
                  ? "STARTED"
                  : event.eventType
                    === "CANARY_OBSERVED"
                    ? "OBSERVING"
                    : "PROMOTED",
            }),
            {
              status: 202,
            },
          );
        },
      },
    );

  assert.notEqual(publisher, undefined);

  if (publisher === undefined) {
    return;
  }

  await publisher.recordStarted(5);
  await publisher.recordObservation({
    trafficPercent: 5,
    healthStatus: "HEALTHY",
    errorRateThresholdPassed: true,
    latencyThresholdPassed: true,
    sampleSize: 200,
  });
  await publisher.recordOutcome("PROMOTED");

  assert.deepEqual(events, [
    {
      eventId:
        "323e4567-e89b-42d3-a456-426614174000",
      eventType: "DEPLOYMENT_STARTED",
      releaseId,
      deploymentAttemptId,
      occurredAt:
        "2026-08-30T17:45:53.000Z",
      provider: "DOCKER_COMPOSE",
      externalDeploymentId: "compose-run-42",
      strategy: "CANARY",
      initialTrafficPercent: 5,
    },
    {
      eventId:
        "423e4567-e89b-42d3-a456-426614174000",
      eventType: "CANARY_OBSERVED",
      releaseId,
      deploymentAttemptId,
      occurredAt:
        "2026-08-30T17:46:53.000Z",
      trafficPercent: 5,
      healthStatus: "HEALTHY",
      errorRateThresholdPassed: true,
      latencyThresholdPassed: true,
      sampleSize: 200,
    },
    {
      eventId:
        "523e4567-e89b-42d3-a456-426614174000",
      eventType:
        "DEPLOYMENT_OUTCOME_RECORDED",
      releaseId,
      deploymentAttemptId,
      occurredAt:
        "2026-08-30T17:47:53.000Z",
      outcome: "PROMOTED",
    },
  ]);
});
