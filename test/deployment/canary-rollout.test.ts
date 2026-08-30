import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import type {
  CanaryObservation,
} from "../../src/canary-observer.js";
import type {
  CanaryDecision,
  CanaryDecisionReason,
} from "../../src/canary-policy.js";
import {
  runCanaryRollout,
} from "../../src/deployment/canary-rollout.js";
import type {
  CanaryObservationPublication,
  DeploymentLifecyclePublisher,
} from "../../src/deployment/deployment-lifecycle-publisher.js";
import type {
  DeploymentEventReceiptDto,
  DeploymentOutcome,
} from "../../src/dto/deployment-event.js";

const releaseId =
  "123e4567-e89b-42d3-a456-426614174000";
const deploymentAttemptId =
  "223e4567-e89b-42d3-a456-426614174000";

function observation(
  decision: CanaryDecision,
): CanaryObservation {
  const reasonByDecision:
    Record<
      CanaryDecision,
      CanaryDecisionReason
    > = {
      continue:
        "minimum-sample-size-not-reached",
      promote: "policy-passed",
      rollback:
        "maximum-canary-failure-rate-exceeded",
    };

  return {
    totalRequests: 200,
    observations: {
      stable: {
        requests: 180,
        failures: 0,
        maximumLatencyMs: 40,
      },
      canary: {
        requests: 20,
        failures:
          decision === "rollback"
            ? 4
            : 0,
        maximumLatencyMs: 60,
      },
    },
    evaluation: {
      decision,
      reason: reasonByDecision[decision],
      stableFailureRate: 0,
      canaryFailureRate:
        decision === "rollback"
          ? 0.2
          : 0,
      failureRateIncrease:
        decision === "rollback"
          ? 0.2
          : 0,
      canaryMaximumLatencyMs: 60,
      errorRateThresholdPassed:
        decision !== "rollback",
      latencyThresholdPassed: true,
    },
  };
}

function receipt(
  eventType:
    DeploymentEventReceiptDto["eventType"],
): DeploymentEventReceiptDto {
  return {
    eventId:
      "323e4567-e89b-42d3-a456-426614174000",
    eventType,
    releaseId,
    deploymentAttemptId,
    replayed: false,
    releaseStatus: "DEPLOYING",
    deploymentStatus: "OBSERVING",
  };
}

function createPublisher(
  calls: string[],
  failures: ReadonlySet<string> =
    new Set(),
): DeploymentLifecyclePublisher {
  function failIfRequested(
    operation: string,
  ): void {
    if (failures.has(operation)) {
      throw new Error(`${operation} failed`);
    }
  }

  return {
    recordStarted: async (
      initialTrafficPercent,
    ) => {
      const operation =
        `publish-started-${initialTrafficPercent}`;
      calls.push(operation);
      failIfRequested(operation);
      return receipt("DEPLOYMENT_STARTED");
    },
    recordObservation: async (
      value: CanaryObservationPublication,
    ) => {
      const operation =
        `publish-observation-${value.healthStatus}`;
      calls.push(operation);
      failIfRequested(operation);
      return receipt("CANARY_OBSERVED");
    },
    recordOutcome: async (
      outcome: Exclude<
        DeploymentOutcome,
        "BLOCKED"
      >,
    ) => {
      const operation =
        `publish-outcome-${outcome}`;
      calls.push(operation);
      failIfRequested(operation);
      return receipt(
        "DEPLOYMENT_OUTCOME_RECORDED",
      );
    },
  };
}

function baseOptions(
  decision: CanaryDecision,
  calls: string[],
) {
  return {
    initialTrafficPercent: 5 as const,
    startBackends: async () => {
      calls.push("start-backends");
    },
    applyRouting: async (
      mode: "canary" | "promote" | "rollback",
      percent: 5 | 10,
    ) => {
      calls.push(`route-${mode}-${percent}`);
    },
    observe: async () => {
      calls.push("observe");
      return observation(decision);
    },
  };
}

for (const [
  decision,
  routingMode,
  outcome,
  healthStatus,
] of [
  [
    "continue",
    "canary",
    "CONTINUED",
    "UNKNOWN",
  ],
  [
    "promote",
    "promote",
    "PROMOTED",
    "HEALTHY",
  ],
  [
    "rollback",
    "rollback",
    "ROLLED_BACK",
    "UNHEALTHY",
  ],
] as const) {
  test(`publishes the deterministic ${decision} rollout sequence`, async () => {
    const calls: string[] = [];
    const result = await runCanaryRollout({
      ...baseOptions(decision, calls),
      publisher: createPublisher(calls),
    });

    assert.equal(result.routingMode, routingMode);
    assert.equal(result.outcome, outcome);
    assert.deepEqual(calls, [
      "start-backends",
      "route-rollback-5",
      "publish-started-5",
      "route-canary-5",
      "observe",
      `publish-observation-${healthStatus}`,
      `route-${routingMode}-5`,
      `publish-outcome-${outcome}`,
    ]);
  });
}

test("preserves rollout behavior without an external publisher", async () => {
  const calls: string[] = [];
  const result = await runCanaryRollout(
    baseOptions("promote", calls),
  );

  assert.equal(result.outcome, "PROMOTED");
  assert.deepEqual(calls, [
    "start-backends",
    "route-canary-5",
    "observe",
    "route-promote-5",
  ]);
});

test("does not apply canary routing when start publication fails", async () => {
  const calls: string[] = [];

  await assert.rejects(
    runCanaryRollout({
      ...baseOptions("promote", calls),
      publisher: createPublisher(
        calls,
        new Set([
          "publish-started-5",
        ]),
      ),
    }),
    /publish-started-5 failed/u,
  );

  assert.deepEqual(calls, [
    "start-backends",
    "route-rollback-5",
    "publish-started-5",
  ]);
});

test("does not publish a start when stable-only preparation fails", async () => {
  const calls: string[] = [];
  const options = baseOptions("promote", calls);
  let preparationAttempts = 0;

  await assert.rejects(
    runCanaryRollout({
      ...options,
      applyRouting: async (mode, percent) => {
        calls.push(`route-${mode}-${percent}`);
        preparationAttempts += 1;

        if (preparationAttempts === 1) {
          throw new Error(
            "stable preparation failed",
          );
        }
      },
      publisher: createPublisher(calls),
    }),
    /stable preparation failed/u,
  );

  assert.deepEqual(calls, [
    "start-backends",
    "route-rollback-5",
    "route-rollback-5",
  ]);
});

test("rolls back and records failure when observation publication fails", async () => {
  const calls: string[] = [];

  await assert.rejects(
    runCanaryRollout({
      ...baseOptions("promote", calls),
      publisher: createPublisher(
        calls,
        new Set([
          "publish-observation-HEALTHY",
        ]),
      ),
    }),
    /publish-observation-HEALTHY failed/u,
  );

  assert.deepEqual(calls, [
    "start-backends",
    "route-rollback-5",
    "publish-started-5",
    "route-canary-5",
    "observe",
    "publish-observation-HEALTHY",
    "route-rollback-5",
    "publish-outcome-FAILED",
  ]);
});

test("rolls back and records failure when final outcome publication fails", async () => {
  const calls: string[] = [];

  await assert.rejects(
    runCanaryRollout({
      ...baseOptions("promote", calls),
      publisher: createPublisher(
        calls,
        new Set([
          "publish-outcome-PROMOTED",
        ]),
      ),
    }),
    /publish-outcome-PROMOTED failed/u,
  );

  assert.deepEqual(calls, [
    "start-backends",
    "route-rollback-5",
    "publish-started-5",
    "route-canary-5",
    "observe",
    "publish-observation-HEALTHY",
    "route-promote-5",
    "publish-outcome-PROMOTED",
    "route-rollback-5",
    "publish-outcome-FAILED",
  ]);
});

test("surfaces recovery failures without hiding the original rollout failure", async () => {
  const calls: string[] = [];
  const options = baseOptions("promote", calls);
  let rollbackAttempts = 0;

  await assert.rejects(
    runCanaryRollout({
      ...options,
      applyRouting: async (mode, percent) => {
        calls.push(`route-${mode}-${percent}`);

        if (mode === "rollback") {
          rollbackAttempts += 1;

          if (rollbackAttempts > 1) {
            throw new Error(
              "rollback recovery failed",
            );
          }
        }
      },
      publisher: createPublisher(
        calls,
        new Set([
          "publish-observation-HEALTHY",
          "publish-outcome-FAILED",
        ]),
      ),
    }),
    (error: unknown) =>
      error instanceof AggregateError
      && error.errors.length === 3,
  );

  assert.deepEqual(calls, [
    "start-backends",
    "route-rollback-5",
    "publish-started-5",
    "route-canary-5",
    "observe",
    "publish-observation-HEALTHY",
    "route-rollback-5",
    "publish-outcome-FAILED",
  ]);
});
