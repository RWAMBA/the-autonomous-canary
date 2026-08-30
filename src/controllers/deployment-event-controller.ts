import {
  parseDeploymentEvent,
  parseDeploymentEventReceipt,
} from "../dto/deployment-event.js";
import type {
  DeploymentEventReceiptDto,
} from "../dto/deployment-event.js";
import type {
  DeploymentLifecycleRecorder,
} from "../persistence/release-lifecycle-store.js";

export interface DeploymentEventController {
  recordEvent(
    input: unknown,
  ): Promise<DeploymentEventReceiptDto>;
}

export class DefaultDeploymentEventController
implements DeploymentEventController {
  private readonly recorder:
    DeploymentLifecycleRecorder;

  constructor(
    recorder: DeploymentLifecycleRecorder,
  ) {
    this.recorder = recorder;
  }

  async recordEvent(
    input: unknown,
  ): Promise<DeploymentEventReceiptDto> {
    const event =
      parseDeploymentEvent(input);

    return parseDeploymentEventReceipt(
      await this.recorder
        .recordDeploymentEvent(event),
    );
  }
}
