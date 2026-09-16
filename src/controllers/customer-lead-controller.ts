import { randomUUID } from "node:crypto";

import {
  parseCustomerLeadList,
  parseCustomerLeadListQuery,
  parseCustomerLeadId,
  parseCustomerLeadReceipt,
  parseCustomerLeadSubmission,
  parseCustomerLeadTransition,
  parseCustomerLeadTransitionReceipt,
} from "../dto/customer-lead.js";
import type {
  CustomerLeadList,
  CustomerLeadReceipt,
  CustomerLeadTransitionReceipt,
} from "../dto/customer-lead.js";
import type {
  TenantAuthorizationContext,
} from "../authorization/tenant-authorization.js";
import type {
  CustomerLeadStore,
} from "../persistence/customer-lead-store.js";
import { HttpError } from "../middleware/http-error.js";
import type {
  CustomerLeadNotifier,
} from "../qualified-lead-notifier.js";

export interface CustomerLeadController {
  submitLead(input: unknown): Promise<CustomerLeadReceipt>;
  listLeads(
    searchParameters: URLSearchParams,
    authorizationContext: TenantAuthorizationContext,
  ): Promise<CustomerLeadList>;
  transitionLead(
    leadId: string,
    input: unknown,
    authorizationContext: TenantAuthorizationContext,
  ): Promise<CustomerLeadTransitionReceipt>;
}

export interface CustomerLeadControllerOptions {
  readonly createLeadId?: () => string;
  readonly now?: () => Date;
  readonly adminTenantId?: string;
  readonly customerLeadNotifier?: CustomerLeadNotifier;
}

export class DefaultCustomerLeadController
implements CustomerLeadController {
  private readonly createLeadId: () => string;
  private readonly now: () => Date;
  private readonly adminTenantId: string | undefined;
  private readonly customerLeadNotifier: CustomerLeadNotifier | undefined;

  constructor(
    private readonly store: CustomerLeadStore,
    options: CustomerLeadControllerOptions = {},
  ) {
    this.createLeadId = options.createLeadId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.adminTenantId = options.adminTenantId;
    this.customerLeadNotifier = options.customerLeadNotifier;
  }

  async submitLead(input: unknown): Promise<CustomerLeadReceipt> {
    const submission = parseCustomerLeadSubmission(input);
    const leadId = this.createLeadId();
    const submittedAt = this.now().toISOString();

    if (submission.website !== "") {
      return parseCustomerLeadReceipt({
        leadId,
        status: "RECEIVED",
        submittedAt,
      });
    }

    const created = await this.store.createLead({
      leadId,
      contactName: submission.contactName,
      workEmail: submission.workEmail,
      organizationName: submission.organizationName,
      service: submission.service,
      ...(
        submission.repositoryOwner === undefined
        || submission.repositoryName === undefined
          ? {}
          : {
              repositoryOwner: submission.repositoryOwner,
              repositoryName: submission.repositoryName,
            }
      ),
      challenge: submission.challenge,
      consentedAt: submittedAt,
      submissionToken: submission.submissionToken,
      submittedAt,
    });

    await this.customerLeadNotifier?.notify({
      event: "RECEIVED",
      leadId: created.leadId,
      occurredAt: created.submittedAt,
    });

    return parseCustomerLeadReceipt({
      leadId: created.leadId,
      status: "RECEIVED",
      submittedAt: created.submittedAt,
    });
  }

  async listLeads(
    searchParameters: URLSearchParams,
    authorizationContext: TenantAuthorizationContext,
  ): Promise<CustomerLeadList> {
    this.assertManagementTenant(authorizationContext);

    return parseCustomerLeadList(
      await this.store.listLeads(
        parseCustomerLeadListQuery(searchParameters),
      ),
    );
  }

  async transitionLead(
    leadId: string,
    input: unknown,
    authorizationContext: TenantAuthorizationContext,
  ): Promise<CustomerLeadTransitionReceipt> {
    this.assertManagementTenant(authorizationContext);
    const transition = parseCustomerLeadTransition(input);

    const receipt = parseCustomerLeadTransitionReceipt(
      await this.store.transitionLead(
        parseCustomerLeadId(leadId),
        transition.status,
        authorizationContext,
        this.now().toISOString(),
      ),
    );

    if (receipt.status === "QUALIFIED") {
      await this.customerLeadNotifier?.notify({
        event: "QUALIFIED",
        leadId: receipt.leadId,
        occurredAt: receipt.updatedAt,
      });
    }

    return receipt;
  }

  private assertManagementTenant(
    authorizationContext: TenantAuthorizationContext,
  ): void {
    if (
      authorizationContext.provider === "POSTGRES"
      && authorizationContext.tenantId !== this.adminTenantId
    ) {
      throw new HttpError({
        statusCode: 403,
        code: "FORBIDDEN",
        message:
          "The authenticated tenant cannot manage customer acquisition.",
      });
    }
  }
}
