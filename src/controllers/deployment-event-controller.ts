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
import type {
  TenantAuthorizationContext,
  TenantResourceAuthorizer,
} from "../authorization/tenant-authorization.js";
import {
  allowLegacyTenantResources,
} from "../authorization/tenant-authorization.js";

export interface DeploymentEventController {
  recordEvent(
    input: unknown,
    authorizationContext?: TenantAuthorizationContext,
  ): Promise<DeploymentEventReceiptDto>;
}

export class DefaultDeploymentEventController
implements DeploymentEventController {
  private readonly recorder:
    DeploymentLifecycleRecorder;

  constructor(
    recorder: DeploymentLifecycleRecorder,
    private readonly resourceAuthorizer:
      TenantResourceAuthorizer = allowLegacyTenantResources,
  ) {
    this.recorder = recorder;
  }

  async recordEvent(
    input: unknown,
    authorizationContext?: TenantAuthorizationContext,
  ): Promise<DeploymentEventReceiptDto> {
    const event =
      parseDeploymentEvent(input);

    if (authorizationContext !== undefined) {
      await this.resourceAuthorizer.assertReleaseAccess(
        authorizationContext,
        event.releaseId,
      );
    }

    return parseDeploymentEventReceipt(
      await this.recorder
        .recordDeploymentEvent(event),
    );
  }
}
