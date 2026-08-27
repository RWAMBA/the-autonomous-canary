import type {
  CanaryDecision,
} from "./canary-policy.js";

export type RoutingMode =
  | "canary"
  | "promote"
  | "rollback";

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
