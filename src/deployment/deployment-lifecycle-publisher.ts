import {
  randomUUID,
} from "node:crypto";

import type {
  DeploymentEventReceiptDto,
  DeploymentOutcome,
} from "../dto/deployment-event.js";
import type {
  DeploymentEventPublisherConfig,
  HttpDeploymentEventPublisherConfig,
} from "./deployment-event-publisher-config.js";
import {
  HttpDeploymentEventPublisher,
  type HttpDeploymentEventPublisherOptions,
} from "./deployment-event-publisher.js";

export interface CanaryObservationPublication {
  readonly trafficPercent: number;
  readonly healthStatus:
    "HEALTHY" | "UNHEALTHY" | "UNKNOWN";
  readonly errorRateThresholdPassed:
    boolean;
  readonly latencyThresholdPassed:
    boolean;
  readonly sampleSize: number;
}

export interface DeploymentLifecyclePublisher {
  recordStarted(
    initialTrafficPercent: number,
  ): Promise<DeploymentEventReceiptDto>;
  recordObservation(
    observation: CanaryObservationPublication,
  ): Promise<DeploymentEventReceiptDto>;
  recordOutcome(
    outcome: Exclude<
      DeploymentOutcome,
      "BLOCKED"
    >,
  ): Promise<DeploymentEventReceiptDto>;
}

export interface DeploymentLifecyclePublisherOptions
extends HttpDeploymentEventPublisherOptions {
  readonly createEventId?: () => string;
  readonly now?: () => Date;
}

class DefaultDeploymentLifecyclePublisher
implements DeploymentLifecyclePublisher {
  private readonly config:
    HttpDeploymentEventPublisherConfig;
  private readonly publisher:
    HttpDeploymentEventPublisher;
  private readonly createEventId:
    () => string;
  private readonly now: () => Date;

  constructor(
    config: HttpDeploymentEventPublisherConfig,
    options:
      DeploymentLifecyclePublisherOptions,
  ) {
    this.config = config;
    this.publisher =
      new HttpDeploymentEventPublisher(
        config,
        options,
      );
    this.createEventId =
      options.createEventId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async recordStarted(
    initialTrafficPercent: number,
  ): Promise<DeploymentEventReceiptDto> {
    return this.publisher.publish({
      eventId: this.createEventId(),
      eventType: "DEPLOYMENT_STARTED",
      releaseId: this.config.releaseId,
      deploymentAttemptId:
        this.config.deploymentAttemptId,
      occurredAt: this.now().toISOString(),
      provider:
        this.config.deploymentProvider,
      ...(this.config.externalDeploymentId
        === undefined
        ? {}
        : {
            externalDeploymentId:
              this.config.externalDeploymentId,
          }),
      strategy: "CANARY",
      initialTrafficPercent,
    });
  }

  async recordObservation(
    observation: CanaryObservationPublication,
  ): Promise<DeploymentEventReceiptDto> {
    return this.publisher.publish({
      eventId: this.createEventId(),
      eventType: "CANARY_OBSERVED",
      releaseId: this.config.releaseId,
      deploymentAttemptId:
        this.config.deploymentAttemptId,
      occurredAt: this.now().toISOString(),
      ...observation,
    });
  }

  async recordOutcome(
    outcome: Exclude<
      DeploymentOutcome,
      "BLOCKED"
    >,
  ): Promise<DeploymentEventReceiptDto> {
    return this.publisher.publish({
      eventId: this.createEventId(),
      eventType:
        "DEPLOYMENT_OUTCOME_RECORDED",
      releaseId: this.config.releaseId,
      deploymentAttemptId:
        this.config.deploymentAttemptId,
      occurredAt: this.now().toISOString(),
      outcome,
    });
  }
}

export function createDeploymentLifecyclePublisher(
  config: DeploymentEventPublisherConfig,
  options:
    DeploymentLifecyclePublisherOptions = {},
): DeploymentLifecyclePublisher | undefined {
  if (config.publisher === "DISABLED") {
    return undefined;
  }

  return new DefaultDeploymentLifecyclePublisher(
    config,
    options,
  );
}
