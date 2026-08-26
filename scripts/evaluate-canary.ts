import {
  evaluateCanary,
  type CanaryDecision,
  type CanaryPolicy,
} from "../src/canary-policy.js";

type ReleaseChannel = "stable" | "canary";

interface MutableTrafficSample {
  requests: number;
  failures: number;
}

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

function readReleaseChannel(
  payload: unknown,
): ReleaseChannel {
  if (
    typeof payload !== "object"
    || payload === null
    || !("release" in payload)
  ) {
    throw new Error(
      "Workload response does not contain release metadata.",
    );
  }

  const release = payload.release;

  if (
    typeof release !== "object"
    || release === null
    || !("channel" in release)
  ) {
    throw new Error(
      "Workload response does not contain a release channel.",
    );
  }

  if (
    release.channel !== "stable"
    && release.channel !== "canary"
  ) {
    throw new Error(
      `Unexpected release channel: ${String(release.channel)}`,
    );
  }

  return release.channel;
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
};

const maximumTotalRequests = readPositiveInteger(
  "MAXIMUM_TOTAL_REQUESTS",
  process.env.MAXIMUM_TOTAL_REQUESTS,
  500,
);

const expectedDecision = readExpectedDecision(
  process.env.EXPECTED_DECISION,
);

const observations: Record<
  ReleaseChannel,
  MutableTrafficSample
> = {
  stable: {
    requests: 0,
    failures: 0,
  },
  canary: {
    requests: 0,
    failures: 0,
  },
};

let totalRequests = 0;

while (
  (
    observations.stable.requests
      < policy.minimumStableRequests
    || observations.canary.requests
      < policy.minimumCanaryRequests
  )
  && totalRequests < maximumTotalRequests
) {
  const response = await fetch(
    new URL("/work", gatewayUrl),
  );

  const payload: unknown = await response.json();
  const channel = readReleaseChannel(payload);

  observations[channel].requests += 1;
  totalRequests += 1;

  if (!response.ok) {
    observations[channel].failures += 1;
  }
}

const evaluation = evaluateCanary(
  observations.stable,
  observations.canary,
  policy,
);

console.log(JSON.stringify({
  gatewayUrl: gatewayUrl.toString(),
  totalRequests,
  observations,
  policy,
  evaluation,
}, null, 2));

if (
  expectedDecision !== undefined
  && evaluation.decision !== expectedDecision
) {
  throw new Error(
    `Expected ${expectedDecision}, received ${evaluation.decision}.`,
  );
}

if (
  expectedDecision === undefined
  && evaluation.decision !== "promote"
) {
  throw new Error(
    `Canary deployment blocked: ${evaluation.reason}.`,
  );
}

console.log(
  `Canary decision verified: ${evaluation.decision}.`,
);
