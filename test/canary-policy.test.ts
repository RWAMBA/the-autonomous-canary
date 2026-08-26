import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evaluateCanary,
  type CanaryPolicy,
} from "../src/canary-policy.js";

const policy: CanaryPolicy = {
  minimumStableRequests: 100,
  minimumCanaryRequests: 20,
  maximumCanaryFailureRate: 0.05,
  maximumFailureRateIncrease: 0.05,
};

test("continues when the sample size is insufficient", () => {
  const evaluation = evaluateCanary(
    {
      requests: 100,
      failures: 1,
    },
    {
      requests: 10,
      failures: 0,
    },
    policy,
  );

  assert.equal(evaluation.decision, "continue");
  assert.equal(
    evaluation.reason,
    "minimum-sample-size-not-reached",
  );
  assert.equal(evaluation.stableFailureRate, 0.01);
  assert.equal(evaluation.canaryFailureRate, 0);
  assert.equal(evaluation.failureRateIncrease, -0.01);
  assert.equal(Object.isFrozen(evaluation), true);
});

test("rolls back when the absolute failure limit is exceeded", () => {
  const evaluation = evaluateCanary(
    {
      requests: 100,
      failures: 1,
    },
    {
      requests: 20,
      failures: 2,
    },
    policy,
  );

  assert.equal(evaluation.decision, "rollback");
  assert.equal(
    evaluation.reason,
    "maximum-canary-failure-rate-exceeded",
  );
  assert.equal(evaluation.canaryFailureRate, 0.1);
});

test("rolls back when canary is worse than stable", () => {
  const evaluation = evaluateCanary(
    {
      requests: 100,
      failures: 0,
    },
    {
      requests: 20,
      failures: 1,
    },
    {
      ...policy,
      maximumCanaryFailureRate: 0.1,
      maximumFailureRateIncrease: 0.02,
    },
  );

  assert.equal(evaluation.decision, "rollback");
  assert.equal(
    evaluation.reason,
    "maximum-failure-rate-increase-exceeded",
  );
  assert.equal(evaluation.failureRateIncrease, 0.05);
});

test("promotes when all policy limits pass", () => {
  const evaluation = evaluateCanary(
    {
      requests: 100,
      failures: 1,
    },
    {
      requests: 20,
      failures: 1,
    },
    policy,
  );

  assert.equal(evaluation.decision, "promote");
  assert.equal(evaluation.reason, "policy-passed");
  assert.equal(evaluation.stableFailureRate, 0.01);
  assert.equal(evaluation.canaryFailureRate, 0.05);
});

test("rejects an impossible traffic sample", () => {
  assert.throws(
    () => evaluateCanary(
      {
        requests: 2,
        failures: 3,
      },
      {
        requests: 20,
        failures: 0,
      },
      policy,
    ),
    {
      message:
        "stable.failures cannot exceed stable.requests.",
    },
  );
});
