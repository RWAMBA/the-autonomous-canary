import type {
  CanaryDecision,
} from "./canary-policy.js";

export type RoutingMode =
  | "canary"
  | "promote"
  | "rollback";

export type CanaryTrafficPercent = 5 | 10;

export type RoutingConfig =
  | "canary-5"
  | "canary-10"
  | "promote"
  | "rollback";

export function readCanaryTrafficPercent(
  value: string | undefined,
  fallback: CanaryTrafficPercent = 10,
): CanaryTrafficPercent {
  if (value === undefined) {
    return fallback;
  }

  if (value === "5") {
    return 5;
  }

  if (value === "10") {
    return 10;
  }

  throw new Error(
    "CANARY_INITIAL_TRAFFIC_PERCENT must be 5 or 10.",
  );
}

export function routingConfigForMode(
  routingMode: RoutingMode,
  canaryTrafficPercent:
    CanaryTrafficPercent,
): RoutingConfig {
  if (routingMode === "canary") {
    return `canary-${canaryTrafficPercent}`;
  }

  return routingMode;
}

export function routingModeForDecision(
  decision: CanaryDecision,
): RoutingMode {
  switch (decision) {
    case "continue":
      return "canary";

    case "promote":
      return "promote";

    case "rollback":
      return "rollback";
  }
}
