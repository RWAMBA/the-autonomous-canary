export type CanaryDecision =
  | "continue"
  | "promote"
  | "rollback";

export type CanaryDecisionReason =
  | "minimum-sample-size-not-reached"
  | "maximum-canary-failure-rate-exceeded"
  | "maximum-failure-rate-increase-exceeded"
  | "policy-passed";

export interface TrafficSample {
  readonly requests: number;
  readonly failures: number;
}

export interface CanaryPolicy {
  readonly minimumStableRequests: number;
  readonly minimumCanaryRequests: number;
  readonly maximumCanaryFailureRate: number;
  readonly maximumFailureRateIncrease: number;
}

export interface CanaryEvaluation {
  readonly decision: CanaryDecision;
  readonly reason: CanaryDecisionReason;
  readonly stableFailureRate: number | null;
  readonly canaryFailureRate: number | null;
  readonly failureRateIncrease: number | null;
}

function validateSample(
  name: string,
  sample: TrafficSample,
): void {
  if (
    !Number.isInteger(sample.requests)
    || sample.requests < 0
  ) {
    throw new Error(
      `${name}.requests must be a non-negative integer.`,
    );
  }

  if (
    !Number.isInteger(sample.failures)
    || sample.failures < 0
  ) {
    throw new Error(
      `${name}.failures must be a non-negative integer.`,
    );
  }

  if (sample.failures > sample.requests) {
    throw new Error(
      `${name}.failures cannot exceed ${name}.requests.`,
    );
  }
}

function validateMinimum(
  name: string,
  value: number,
): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `${name} must be a positive integer.`,
    );
  }
}

function validateRate(
  name: string,
  value: number,
): void {
  if (
    !Number.isFinite(value)
    || value < 0
    || value > 1
  ) {
    throw new Error(
      `${name} must be a number between 0 and 1.`,
    );
  }
}

function calculateFailureRate(
  sample: TrafficSample,
): number | null {
  if (sample.requests === 0) {
    return null;
  }

  return sample.failures / sample.requests;
}

function createEvaluation(
  decision: CanaryDecision,
  reason: CanaryDecisionReason,
  stableFailureRate: number | null,
  canaryFailureRate: number | null,
  failureRateIncrease: number | null,
): CanaryEvaluation {
  return Object.freeze({
    decision,
    reason,
    stableFailureRate,
    canaryFailureRate,
    failureRateIncrease,
  });
}

export function evaluateCanary(
  stable: TrafficSample,
  canary: TrafficSample,
  policy: CanaryPolicy,
): CanaryEvaluation {
  validateSample("stable", stable);
  validateSample("canary", canary);

  validateMinimum(
    "minimumStableRequests",
    policy.minimumStableRequests,
  );
  validateMinimum(
    "minimumCanaryRequests",
    policy.minimumCanaryRequests,
  );
  validateRate(
    "maximumCanaryFailureRate",
    policy.maximumCanaryFailureRate,
  );
  validateRate(
    "maximumFailureRateIncrease",
    policy.maximumFailureRateIncrease,
  );

  const stableFailureRate =
    calculateFailureRate(stable);
  const canaryFailureRate =
    calculateFailureRate(canary);

  const failureRateIncrease =
    stableFailureRate === null
    || canaryFailureRate === null
      ? null
      : canaryFailureRate - stableFailureRate;

  if (
    stable.requests < policy.minimumStableRequests
    || canary.requests < policy.minimumCanaryRequests
  ) {
    return createEvaluation(
      "continue",
      "minimum-sample-size-not-reached",
      stableFailureRate,
      canaryFailureRate,
      failureRateIncrease,
    );
  }

  if (
    canaryFailureRate === null
    || failureRateIncrease === null
  ) {
    throw new Error(
      "Failure rates are unavailable after sample validation.",
    );
  }

  if (
    canaryFailureRate
    > policy.maximumCanaryFailureRate
  ) {
    return createEvaluation(
      "rollback",
      "maximum-canary-failure-rate-exceeded",
      stableFailureRate,
      canaryFailureRate,
      failureRateIncrease,
    );
  }

  if (
    failureRateIncrease
    > policy.maximumFailureRateIncrease
  ) {
    return createEvaluation(
      "rollback",
      "maximum-failure-rate-increase-exceeded",
      stableFailureRate,
      canaryFailureRate,
      failureRateIncrease,
    );
  }

  return createEvaluation(
    "promote",
    "policy-passed",
    stableFailureRate,
    canaryFailureRate,
    failureRateIncrease,
  );
}
