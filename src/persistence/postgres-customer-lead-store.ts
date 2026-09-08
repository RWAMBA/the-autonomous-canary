import { createHash, randomUUID } from "node:crypto";
import type {
  Pool,
  PoolClient,
  QueryResultRow,
} from "pg";

import {
  parseCustomerLeadList,
  parseCustomerLeadTransitionReceipt,
} from "../dto/customer-lead.js";
import type {
  CustomerLeadList,
  CustomerLeadListQuery,
  CustomerLeadStatus,
  CustomerLeadTransitionReceipt,
} from "../dto/customer-lead.js";
import type {
  TenantAuthorizationContext,
} from "../authorization/tenant-authorization.js";
import { HttpError } from "../middleware/http-error.js";
import type {
  CreatedCustomerLead,
  CustomerLeadStore,
  NewCustomerLead,
} from "./customer-lead-store.js";

interface CustomerLeadRow extends QueryResultRow {
  readonly lead_id: string;
  readonly contact_name: string;
  readonly work_email: string;
  readonly organization_name: string;
  readonly service: string;
  readonly repository_owner: string | null;
  readonly repository_name: string | null;
  readonly challenge: string;
  readonly status: CustomerLeadStatus;
  readonly submitted_at: Date | string;
  readonly updated_at: Date | string;
  readonly retention_expires_at: Date | string;
  readonly payload_sha256?: string;
}

const allowedTransitions: Readonly<
  Record<CustomerLeadStatus, ReadonlySet<CustomerLeadStatus>>
> = {
  NEW: new Set(["QUALIFIED", "CLOSED"]),
  QUALIFIED: new Set(["PROPOSAL_SENT", "CLOSED"]),
  PROPOSAL_SENT: new Set(["ENGAGED", "CLOSED"]),
  ENGAGED: new Set(["CLOSED"]),
  CLOSED: new Set(),
};

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function payloadDigest(lead: NewCustomerLead): string {
  return digest(JSON.stringify({
    contactName: lead.contactName,
    workEmail: lead.workEmail,
    organizationName: lead.organizationName,
    service: lead.service,
    repositoryOwner: lead.repositoryOwner ?? null,
    repositoryName: lead.repositoryName ?? null,
    challenge: lead.challenge,
  }));
}

function asIsoDateTime(
  value: Date | string,
  field: string,
): string {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new Error(`${field} is not a valid timestamp.`);
  }

  return date.toISOString();
}

function mapLead(row: CustomerLeadRow) {
  return {
    leadId: row.lead_id,
    contactName: row.contact_name,
    workEmail: row.work_email,
    organizationName: row.organization_name,
    service: row.service,
    ...(
      row.repository_owner === null
      || row.repository_name === null
        ? {}
        : {
            repositoryOwner: row.repository_owner,
            repositoryName: row.repository_name,
          }
    ),
    challenge: row.challenge,
    status: row.status,
    submittedAt: asIsoDateTime(row.submitted_at, "submitted_at"),
    updatedAt: asIsoDateTime(row.updated_at, "updated_at"),
    retentionExpiresAt: asIsoDateTime(
      row.retention_expires_at,
      "retention_expires_at",
    ),
  };
}

function notFound(): HttpError {
  return new HttpError({
    statusCode: 404,
    code: "CUSTOMER_LEAD_NOT_FOUND",
    message: "The requested customer lead was not found.",
  });
}

export class PostgresCustomerLeadStore
implements CustomerLeadStore {
  constructor(private readonly pool: Pool) {}

  async createLead(
    lead: NewCustomerLead,
  ): Promise<CreatedCustomerLead> {
    const tokenSha256 = digest(lead.submissionToken);
    const contentSha256 = payloadDigest(lead);
    const result = await this.pool.query<CustomerLeadRow>(
      `INSERT INTO customer_leads (
         lead_id,
         contact_name,
         work_email,
         organization_name,
         service,
         repository_owner,
         repository_name,
         challenge,
         consented_at,
         submission_token_sha256,
         payload_sha256,
         submitted_at,
         updated_at,
         retention_expires_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $12,
         $12::timestamptz + interval '180 days'
       )
       ON CONFLICT (submission_token_sha256) DO NOTHING
       RETURNING lead_id, status, submitted_at`,
      [
        lead.leadId,
        lead.contactName,
        lead.workEmail,
        lead.organizationName,
        lead.service,
        lead.repositoryOwner ?? null,
        lead.repositoryName ?? null,
        lead.challenge,
        lead.consentedAt,
        tokenSha256,
        contentSha256,
        lead.submittedAt,
      ],
    );
    const inserted = result.rows[0];

    if (inserted !== undefined) {
      return {
        leadId: inserted.lead_id,
        status: "NEW",
        submittedAt: asIsoDateTime(inserted.submitted_at, "submitted_at"),
      };
    }

    const existing = await this.pool.query<CustomerLeadRow>(
      `SELECT lead_id, status, submitted_at, payload_sha256
       FROM customer_leads
       WHERE submission_token_sha256 = $1
       LIMIT 1`,
      [tokenSha256],
    );
    const row = existing.rows[0];

    if (row === undefined || row.payload_sha256 !== contentSha256) {
      throw new HttpError({
        statusCode: 409,
        code: "SUBMISSION_TOKEN_CONFLICT",
        message:
          "The submission token was already used for different lead data.",
      });
    }

    return {
      leadId: row.lead_id,
      status: "NEW",
      submittedAt: asIsoDateTime(row.submitted_at, "submitted_at"),
    };
  }

  async listLeads(
    query: CustomerLeadListQuery,
  ): Promise<CustomerLeadList> {
    const values: unknown[] = [];
    const statusPredicate = query.status === undefined
      ? ""
      : "WHERE status = $1";

    if (query.status !== undefined) {
      values.push(query.status);
    }

    values.push(query.limit);
    const result = await this.pool.query<CustomerLeadRow>(
      `SELECT
         lead_id,
         contact_name,
         work_email,
         organization_name,
         service,
         repository_owner,
         repository_name,
         challenge,
         status,
         submitted_at,
         updated_at,
         retention_expires_at
       FROM customer_leads
       ${statusPredicate}
       ORDER BY submitted_at DESC, lead_id DESC
       LIMIT $${values.length}`,
      values,
    );

    return parseCustomerLeadList({
      leads: result.rows.map(mapLead),
    });
  }

  async transitionLead(
    leadId: string,
    status: CustomerLeadStatus,
    authorizationContext: TenantAuthorizationContext,
    occurredAt: string,
  ): Promise<CustomerLeadTransitionReceipt> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const current = await client.query<CustomerLeadRow>(
        `SELECT lead_id, status
         FROM customer_leads
         WHERE lead_id = $1
         FOR UPDATE`,
        [leadId],
      );
      const row = current.rows[0];

      if (row === undefined) {
        throw notFound();
      }

      if (row.status === status) {
        await client.query("COMMIT");
        return parseCustomerLeadTransitionReceipt({
          leadId,
          status,
          updatedAt: occurredAt,
        });
      }

      if (!allowedTransitions[row.status].has(status)) {
        throw new HttpError({
          statusCode: 409,
          code: "INVALID_LEAD_STATUS_TRANSITION",
          message:
            `Customer lead cannot transition from ${row.status} to ${status}.`,
        });
      }

      await client.query(
        `UPDATE customer_leads
         SET status = $2, updated_at = $3
         WHERE lead_id = $1`,
        [leadId, status, occurredAt],
      );
      await client.query(
        `INSERT INTO customer_lead_status_events (
           lead_status_event_id,
           lead_id,
           previous_status,
           next_status,
           actor_provider,
           actor_tenant_id,
           actor_credential_id,
           occurred_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          randomUUID(),
          leadId,
          row.status,
          status,
          authorizationContext.provider,
          authorizationContext.provider === "POSTGRES"
            ? authorizationContext.tenantId
            : null,
          authorizationContext.provider === "POSTGRES"
            ? authorizationContext.credentialId
            : null,
          occurredAt,
        ],
      );
      await client.query("COMMIT");

      return parseCustomerLeadTransitionReceipt({
        leadId,
        status,
        updatedAt: occurredAt,
      });
    } catch (error) {
      await this.rollback(client, error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async rollback(
    client: PoolClient,
    originalError: unknown,
  ): Promise<void> {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      throw new AggregateError(
        [originalError, rollbackError],
        "Customer lead transaction and rollback both failed.",
      );
    }
  }
}
