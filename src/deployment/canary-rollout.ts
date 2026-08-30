import type {
  CanaryObservation,
} from "../canary-observer.js";
import type {
  DeploymentOutcome,
} from "../dto/deployment-event.js";
import {
  routingModeForDecision,
  type CanaryTrafficPercent,
  type RoutingMode,
} from "../routing-mode.js";
import type {
  DeploymentLifecyclePublisher,
} from "./deployment-lifecycle-publisher.js";

type AttemptedDeploymentOutcome = Exclude<
  DeploymentOutcome,
  "BLOCKED"
>;

export interface CanaryRolloutOptions {
  readonly initialTrafficPercent:
    CanaryTrafficPercent;
  readonly startBackends:
    () => void | Promise<void>;
  readonly applyRouting: (
    routingMode: RoutingMode,
    canaryTrafficPercent:
      CanaryTrafficPercent,
  ) => void | Promise<void>;
  readonly observe:
    () => Promise<CanaryObservation>;
  readonly publisher?:
    DeploymentLifecyclePublisher;
}

export interface CanaryRolloutResult {
  readonly observation: CanaryObservation;
  readonly routingMode: RoutingMode;
  readonly outcome:
    AttemptedDeploymentOutcome;
}

function healthStatusForObservation(
  observation: CanaryObservation,
): "HEALTHY" | "UNHEALTHY" | "UNKNOWN" {
  switch (observation.evaluation.decision) {
    case "continue":
      return "UNKNOWN";

    case "promote":
      return "HEALTHY";

    case "rollback":
      return "UNHEALTHY";
  }
}

function outcomeForRoutingMode(
  routingMode: RoutingMode,
): AttemptedDeploymentOutcome {
  switch (routingMode) {
    case "canary":
      return "CONTINUED";

    case "promote":
      return "PROMOTED";

    case "rollback":
      return "ROLLED_BACK";
  }
}

export async function runCanaryRollout(
  options: CanaryRolloutOptions,
): Promise<CanaryRolloutResult> {
  let deploymentStarted = false;
  let routingAttempted = false;
  let rollbackApplied = false;
  let outcomeRecorded = false;

  try {
    await options.startBackends();

    if (options.publisher !== undefined) {
      routingAttempted = true;
      await options.applyRouting(
        "rollback",
        options.initialTrafficPercent,
      );
      rollbackApplied = true;

      await options.publisher.recordStarted(
        options.initialTrafficPercent,
      );
      deploymentStarted = true;
    }

    routingAttempted = true;
    rollbackApplied = false;
    await options.applyRouting(
      "canary",
      options.initialTrafficPercent,
    );

    const observation = await options.observe();

    if (options.publisher !== undefined) {
      await options.publisher.recordObservation({
        trafficPercent:
          options.initialTrafficPercent,
        healthStatus:
          healthStatusForObservation(
            observation,
          ),
        errorRateThresholdPassed:
          observation.evaluation
            .errorRateThresholdPassed,
        latencyThresholdPassed:
          observation.evaluation
            .latencyThresholdPassed,
        sampleSize:
          observation.totalRequests,
      });
    }

    const routingMode =
      routingModeForDecision(
        observation.evaluation.decision,
      );

    await options.applyRouting(
      routingMode,
      options.initialTrafficPercent,
    );

    rollbackApplied =
      routingMode === "rollback";

    const outcome =
      outcomeForRoutingMode(routingMode);

    if (options.publisher !== undefined) {
      await options.publisher.recordOutcome(
        outcome,
      );
      outcomeRecorded = true;
    }

    return Object.freeze({
      observation,
      routingMode,
      outcome,
    });
  } catch (error) {
    const recoveryErrors: unknown[] = [];

    if (
      routingAttempted
      && !rollbackApplied
    ) {
      try {
        await options.applyRouting(
          "rollback",
          options.initialTrafficPercent,
        );
      } catch (rollbackError) {
        recoveryErrors.push(rollbackError);
      }
    }

    if (
      deploymentStarted
      && !outcomeRecorded
      && options.publisher !== undefined
    ) {
      try {
        await options.publisher.recordOutcome(
          "FAILED",
        );
      } catch (publicationError) {
        recoveryErrors.push(
          publicationError,
        );
      }
    }

    if (recoveryErrors.length > 0) {
      throw new AggregateError(
        [
          error,
          ...recoveryErrors,
        ],
        "Canary rollout failed and one or more recovery actions also failed.",
      );
    }

    throw error;
  }
}
