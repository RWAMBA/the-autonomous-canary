import assert from "node:assert/strict";
import { test } from "node:test";

import {
  observeCanary,
  type ObservedReleaseChannel,
  type WorkloadResponse,
} from "../src/canary-observer.js";
import type {
  CanaryPolicy,
} from "../src/canary-policy.js";

const policy: CanaryPolicy = {
  minimumStableRequests: 2,
  minimumCanaryRequests: 1,
  maximumCanaryFailureRate: 0.1,
  maximumFailureRateIncrease: 0.1,
};

function workloadResponse(
  channel: ObservedReleaseChannel,
  ok = true,
): WorkloadResponse {
  return {
    ok,
    payload: {
      release: {
        channel,
      },
    },
  };
}

function createRequester(
  responses: WorkloadResponse[],
): () => Promise<WorkloadResponse> {
  return async () => {
    const response = responses.shift();

    if (response === undefined) {
      throw new Error(
        "No prepared workload response remains.",
      );
    }

    return response;
  };
}

test("observes enough healthy traffic to promote", async () => {
  const observation = await observeCanary({
    policy,
    maximumTotalRequests: 10,
    requestWorkload: createRequester([
      workloadResponse("stable"),
      workloadResponse("canary"),
      workloadResponse("stable"),
    ]),
  });

  assert.equal(observation.totalRequests, 3);
  assert.deepEqual(observation.observations, {
    stable: {
      requests: 2,
      failures: 0,
    },
    canary: {
      requests: 1,
      failures: 0,
    },
  });
  assert.equal(
    observation.evaluation.decision,
    "promote",
  );
  assert.equal(Object.isFrozen(observation), true);
  assert.equal(
    Object.isFrozen(observation.observations),
    true,
  );
});

test("observes canary failures and rolls back", async () => {
  const observation = await observeCanary({
    policy: {
      ...policy,
      minimumStableRequests: 1,
      minimumCanaryRequests: 2,
      maximumCanaryFailureRate: 0.25,
    },
    maximumTotalRequests: 10,
    requestWorkload: createRequester([
      workloadResponse("stable"),
      workloadResponse("canary", false),
      workloadResponse("canary"),
    ]),
  });

  assert.deepEqual(observation.observations.canary, {
    requests: 2,
    failures: 1,
  });
  assert.equal(
    observation.evaluation.decision,
    "rollback",
  );
  assert.equal(
    observation.evaluation.reason,
    "maximum-canary-failure-rate-exceeded",
  );
});

test("continues when the request limit is reached", async () => {
  const observation = await observeCanary({
    policy: {
      ...policy,
      minimumStableRequests: 2,
      minimumCanaryRequests: 2,
    },
    maximumTotalRequests: 2,
    requestWorkload: createRequester([
      workloadResponse("stable"),
      workloadResponse("canary"),
    ]),
  });

  assert.equal(observation.totalRequests, 2);
  assert.equal(
    observation.evaluation.decision,
    "continue",
  );
  assert.equal(
    observation.evaluation.reason,
    "minimum-sample-size-not-reached",
  );
});

test("rejects an unexpected release channel", async () => {
  await assert.rejects(
    () => observeCanary({
      policy,
      maximumTotalRequests: 1,
      requestWorkload: async () => ({
        ok: true,
        payload: {
          release: {
            channel: "preview",
          },
        },
      }),
    }),
    {
      message: "Unexpected release channel: preview",
    },
  );
});

test("rejects an invalid maximum request limit", async () => {
  await assert.rejects(
    () => observeCanary({
      policy,
      maximumTotalRequests: 0,
      requestWorkload: async () =>
        workloadResponse("stable"),
    }),
    {
      message:
        "maximumTotalRequests must be a positive integer.",
    },
  );
});
