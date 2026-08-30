import {
  observeCanary,
} from "../src/canary-observer.js";
import type {
  CanaryDecision,
  CanaryPolicy,
} from "../src/canary-policy.js";

function readPositiveInteger(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  const parsedValue = Number(value ?? fallback);

  if (
    !Number.isInteger(parsedValue)
    || parsedValue < 1
  ) {
    throw new Error(
      `${name} must be a positive integer.`,
    );
  }

  return parsedValue;
}

function readRate(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  const parsedValue = Number(value ?? fallback);

  if (
    !Number.isFinite(parsedValue)
    || parsedValue < 0
    || parsedValue > 1
  ) {
    throw new Error(
      `${name} must be a number between 0 and 1.`,
    );
  }

  return parsedValue;
}

function readExpectedDecision(
  value: string | undefined,
): CanaryDecision | undefined {
  const normalized = value?.trim();

  if (
    normalized === undefined
    || normalized.length === 0
  ) {
    return undefined;
  }

  if (
    normalized !== "continue"
    && normalized !== "promote"
    && normalized !== "rollback"
  ) {
    throw new Error(
      "EXPECTED_DECISION must be continue, promote, or rollback.",
    );
  }

  return normalized;
}

const gatewayUrl = new URL(
  process.env.GATEWAY_URL
    ?? "http://127.0.0.1:8080",
);

const policy: CanaryPolicy = {
  minimumStableRequests: readPositiveInteger(
    "MINIMUM_STABLE_REQUESTS",
    process.env.MINIMUM_STABLE_REQUESTS,
    100,
  ),
  minimumCanaryRequests: readPositiveInteger(
    "MINIMUM_CANARY_REQUESTS",
    process.env.MINIMUM_CANARY_REQUESTS,
    20,
  ),
  maximumCanaryFailureRate: readRate(
    "MAXIMUM_CANARY_FAILURE_RATE",
    process.env.MAXIMUM_CANARY_FAILURE_RATE,
    0.05,
  ),
  maximumFailureRateIncrease: readRate(
    "MAXIMUM_FAILURE_RATE_INCREASE",
    process.env.MAXIMUM_FAILURE_RATE_INCREASE,
    0.02,
  ),
  maximumCanaryLatencyMs:
    readPositiveInteger(
      "MAXIMUM_CANARY_LATENCY_MS",
      process.env.MAXIMUM_CANARY_LATENCY_MS,
      1_000,
    ),
};

const maximumTotalRequests = readPositiveInteger(
  "MAXIMUM_TOTAL_REQUESTS",
  process.env.MAXIMUM_TOTAL_REQUESTS,
  500,
);

const expectedDecision = readExpectedDecision(
  process.env.EXPECTED_DECISION,
);

const observation = await observeCanary({
  policy,
  maximumTotalRequests,
  requestWorkload: async () => {
    const response = await fetch(
      new URL("/work", gatewayUrl),
    );

    return {
      ok: response.ok,
      payload: await response.json(),
    };
  },
});

console.log(JSON.stringify({
  gatewayUrl: gatewayUrl.toString(),
  totalRequests: observation.totalRequests,
  observations: observation.observations,
  policy,
  evaluation: observation.evaluation,
}, null, 2));

if (
  expectedDecision !== undefined
  && observation.evaluation.decision
    !== expectedDecision
) {
  throw new Error(
    `Expected ${expectedDecision}, received ${
      observation.evaluation.decision
    }.`,
  );
}

if (
  expectedDecision === undefined
  && observation.evaluation.decision !== "promote"
) {
  throw new Error(
    `Canary deployment blocked: ${
      observation.evaluation.reason
    }.`,
  );
}

console.log(
  `Canary decision verified: ${
    observation.evaluation.decision
  }.`,
);
