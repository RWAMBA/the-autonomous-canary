import type {
  CustomerLeadList,
  CustomerLeadListQuery,
  CustomerLeadStatus,
  CustomerLeadTransitionReceipt,
} from "../dto/customer-lead.js";
import type {
  TenantAuthorizationContext,
} from "../authorization/tenant-authorization.js";

export interface NewCustomerLead {
  readonly leadId: string;
  readonly contactName: string;
  readonly workEmail: string;
  readonly organizationName: string;
  readonly service: string;
  readonly repositoryOwner?: string;
  readonly repositoryName?: string;
  readonly challenge: string;
  readonly consentedAt: string;
  readonly submissionToken: string;
  readonly submittedAt: string;
}

export interface CreatedCustomerLead {
  readonly leadId: string;
  readonly status: "NEW";
  readonly submittedAt: string;
}

export interface CustomerLeadStore {
  createLead(
    lead: NewCustomerLead,
  ): Promise<CreatedCustomerLead>;
  listLeads(
    query: CustomerLeadListQuery,
  ): Promise<CustomerLeadList>;
  transitionLead(
    leadId: string,
    status: CustomerLeadStatus,
    authorizationContext: TenantAuthorizationContext,
    occurredAt: string,
  ): Promise<CustomerLeadTransitionReceipt>;
}
