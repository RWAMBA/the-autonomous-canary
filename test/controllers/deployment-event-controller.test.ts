import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  DefaultDeploymentEventController,
} from "../../src/controllers/deployment-event-controller.js";
import type {
  DeploymentEventDto,
} from "../../src/dto/deployment-event.js";

const releaseId =
  "123e4567-e89b-42d3-a456-426614174000";
const attemptId =
  "223e4567-e89b-42d3-a456-426614174000";
const eventId =
  "323e4567-e89b-42d3-a456-426614174000";

test("validates and records a deployment event", async () => {
  let recorded:
    DeploymentEventDto | undefined;

  const controller =
    new DefaultDeploymentEventController({
      recordDeploymentEvent: (event) => {
        recorded = event;

        if (
          event.eventType
          !== "DEPLOYMENT_STARTED"
        ) {
          throw new Error(
            "Expected a deployment start event.",
          );
        }

        return Promise.resolve({
          eventId: event.eventId,
          eventType: event.eventType,
          releaseId: event.releaseId,
          deploymentAttemptId:
            event.deploymentAttemptId,
          replayed: false,
          releaseStatus: "DEPLOYING",
          deploymentStatus: "STARTED",
        });
      },
    });

  const receipt = await controller.recordEvent({
    eventId,
    eventType: "DEPLOYMENT_STARTED",
    releaseId,
    deploymentAttemptId: attemptId,
    occurredAt:
      "2026-08-30T15:32:42.000Z",
    provider: "RENDER",
    strategy: "CANARY",
    initialTrafficPercent: 5,
  });

  assert.equal(
    recorded?.eventType,
    "DEPLOYMENT_STARTED",
  );
  assert.equal(receipt.replayed, false);
});

test("does not call persistence for an invalid event", async () => {
  let calls = 0;
  const controller =
    new DefaultDeploymentEventController({
      recordDeploymentEvent: () => {
        calls += 1;
        throw new Error("unexpected call");
      },
    });

  await assert.rejects(
    controller.recordEvent({}),
    {
      name: "ZodError",
    },
  );
  assert.equal(calls, 0);
});

test("rejects an invalid persistence receipt", async () => {
  const controller =
    new DefaultDeploymentEventController({
      recordDeploymentEvent: () =>
        Promise.resolve({
          eventId,
          eventType: "DEPLOYMENT_STARTED",
          releaseId,
          deploymentAttemptId: attemptId,
          replayed: false,
          releaseStatus: "DEPLOYING",
          deploymentStatus:
            "INVALID" as "STARTED",
        }),
    });

  await assert.rejects(
    controller.recordEvent({
      eventId,
      eventType: "DEPLOYMENT_STARTED",
      releaseId,
      deploymentAttemptId: attemptId,
      occurredAt:
        "2026-08-30T15:32:42.000Z",
      provider: "RENDER",
      strategy: "CANARY",
      initialTrafficPercent: 5,
    }),
    {
      name: "ZodError",
    },
  );
});
