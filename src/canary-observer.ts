import {
  performance,
} from "node:perf_hooks";

import {
  evaluateCanary,
  type CanaryEvaluation,
  type CanaryPolicy,
  type TrafficSample,
} from "./canary-policy.js";

export type ObservedReleaseChannel =
  | "stable"
  | "canary";

export interface WorkloadResponse {
  readonly ok: boolean;
  readonly payload: unknown;
}

export interface CanaryObservation {
  readonly totalRequests: number;
  readonly observations: Readonly<
    Record<ObservedReleaseChannel, TrafficSample>
  >;
  readonly evaluation: CanaryEvaluation;
}

export interface ObserveCanaryOptions {
  readonly policy: CanaryPolicy;
  readonly maximumTotalRequests: number;
  readonly requestWorkload: () => Promise<WorkloadResponse>;
  readonly now?: () => number;
}

interface MutableTrafficSample {
  requests: number;
  failures: number;
  maximumLatencyMs: number | null;
}

function readReleaseChannel(
  payload: unknown,
): ObservedReleaseChannel {
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

export async function observeCanary(
  options: ObserveCanaryOptions,
): Promise<CanaryObservation> {
  if (
    !Number.isInteger(options.maximumTotalRequests)
    || options.maximumTotalRequests < 1
  ) {
    throw new Error(
      "maximumTotalRequests must be a positive integer.",
    );
  }

  const observations: Record<
    ObservedReleaseChannel,
    MutableTrafficSample
  > = {
    stable: {
      requests: 0,
      failures: 0,
      maximumLatencyMs: null,
    },
    canary: {
      requests: 0,
      failures: 0,
      maximumLatencyMs: null,
    },
  };

  let totalRequests = 0;
  const now = options.now
    ?? (() => performance.now());

  while (
    (
      observations.stable.requests
        < options.policy.minimumStableRequests
      || observations.canary.requests
        < options.policy.minimumCanaryRequests
    )
    && totalRequests < options.maximumTotalRequests
  ) {
    const startedAt = now();
    const response = await options.requestWorkload();
    const completedAt = now();

    if (
      !Number.isFinite(startedAt)
      || !Number.isFinite(completedAt)
      || completedAt < startedAt
    ) {
      throw new Error(
        "Canary observation clock must return increasing finite values.",
      );
    }

    const latencyMs =
      completedAt - startedAt;
    const channel = readReleaseChannel(response.payload);

    observations[channel].requests += 1;
    observations[channel].maximumLatencyMs =
      Math.max(
        observations[channel]
          .maximumLatencyMs ?? 0,
        latencyMs,
      );
    totalRequests += 1;

    if (!response.ok) {
      observations[channel].failures += 1;
    }
  }

  const frozenObservations = Object.freeze({
    stable: Object.freeze({
      ...observations.stable,
    }),
    canary: Object.freeze({
      ...observations.canary,
    }),
  });

  return Object.freeze({
    totalRequests,
    observations: frozenObservations,
    evaluation: evaluateCanary(
      frozenObservations.stable,
      frozenObservations.canary,
      options.policy,
    ),
  });
}
