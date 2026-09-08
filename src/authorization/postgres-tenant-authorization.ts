import {
  createHash,
  randomUUID,
} from "node:crypto";
import type {
  IncomingMessage,
} from "node:http";
import type {
  Pool,
} from "pg";

import {
  HttpError,
} from "../middleware/http-error.js";
import {
  readReviewBearerToken,
} from "../middleware/require-review-api-key.js";
import type {
  RepositoryResource,
  TenantAuthorizationContext,
  TenantPermission,
  TenantResourceAuthorizer,
  TenantRole,
} from "./tenant-authorization.js";

interface CredentialRow {
  readonly credential_id: string;
  readonly tenant_id: string;
  readonly role: TenantRole;
}

const rolePermissions: Readonly<
  Record<TenantRole, ReadonlySet<TenantPermission>>
> = {
  ADMIN: new Set([
    "REVIEW_WRITE",
    "DEPLOYMENT_WRITE",
    "REPORT_READ",
  ]),
  AUTOMATION: new Set([
    "REVIEW_WRITE",
    "DEPLOYMENT_WRITE",
    "REPORT_READ",
  ]),
  VIEWER: new Set(["REPORT_READ"]),
};

function digestApiKey(value: string): string {
  return createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function unauthorized(): HttpError {
  return new HttpError({
    statusCode: 401,
    code: "UNAUTHORIZED",
    message: "A valid bearer token is required.",
  });
}

function forbidden(): HttpError {
  return new HttpError({
    statusCode: 403,
    code: "FORBIDDEN",
    message: "The credential does not grant this permission.",
  });
}

function resourceNotFound(): HttpError {
  return new HttpError({
    statusCode: 404,
    code: "RESOURCE_NOT_FOUND",
    message: "The requested resource was not found.",
  });
}

export class PostgresTenantAuthorization
implements TenantResourceAuthorizer {
  constructor(private readonly pool: Pool) {}

  async authenticateRequest(
    request: IncomingMessage,
    permission: TenantPermission,
  ): Promise<TenantAuthorizationContext> {
    const digest = digestApiKey(
      readReviewBearerToken(request),
    );
    const result = await this.pool.query<CredentialRow>(
      `SELECT
         credential.credential_id,
         credential.tenant_id,
         credential.role
       FROM tenant_api_credentials AS credential
       JOIN tenants AS tenant
         ON tenant.tenant_id = credential.tenant_id
       WHERE credential.key_sha256 = $1
         AND credential.status = 'ACTIVE'
         AND tenant.status = 'ACTIVE'
         AND (
           credential.expires_at IS NULL
           OR credential.expires_at > now()
         )
       LIMIT 1`,
      [digest],
    );
    const credential = result.rows[0];

    if (credential === undefined) {
      throw unauthorized();
    }

    if (!rolePermissions[credential.role].has(permission)) {
      await this.recordAudit(
        credential,
        permission,
        "DENIED",
        "ROLE_PERMISSION_DENIED",
      );
      throw forbidden();
    }

    await this.recordAudit(
      credential,
      permission,
      "ALLOWED",
      "CREDENTIAL_AUTHENTICATED",
    );

    return {
      provider: "POSTGRES",
      tenantId: credential.tenant_id,
      credentialId: credential.credential_id,
      role: credential.role,
    };
  }

  async assertRepositoryAccess(
    context: TenantAuthorizationContext,
    repository: RepositoryResource,
    permission: TenantPermission = "REPORT_READ",
  ): Promise<void> {
    if (context.provider === "LEGACY") {
      return;
    }

    const result = await this.pool.query(
      `SELECT true AS authorized
       FROM tenant_repository_access AS access
       JOIN repositories AS repository
         ON repository.repository_id = access.repository_id
       WHERE access.tenant_id = $1
         AND lower(repository.owner) = lower($2)
         AND lower(repository.name) = lower($3)
       LIMIT 1`,
      [context.tenantId, repository.owner, repository.name],
    );

    if (result.rows[0] === undefined) {
      await this.recordAudit(
        context,
        permission,
        "DENIED",
        "REPOSITORY_ACCESS_DENIED",
        "REPOSITORY",
        `${repository.owner}/${repository.name}`,
      );
      throw resourceNotFound();
    }

    await this.recordAudit(
      context,
      permission,
      "ALLOWED",
      "REPOSITORY_ACCESS_ALLOWED",
      "REPOSITORY",
      `${repository.owner}/${repository.name}`,
    );
  }

  async assertReleaseAccess(
    context: TenantAuthorizationContext,
    releaseId: string,
  ): Promise<void> {
    if (context.provider === "LEGACY") {
      return;
    }

    const result = await this.pool.query(
      `SELECT true AS authorized
       FROM tenant_repository_access AS access
       JOIN releases AS release
         ON release.repository_id = access.repository_id
       WHERE access.tenant_id = $1
         AND release.release_id = $2
       LIMIT 1`,
      [context.tenantId, releaseId],
    );

    if (result.rows[0] === undefined) {
      await this.recordAudit(
        context,
        "DEPLOYMENT_WRITE",
        "DENIED",
        "RELEASE_ACCESS_DENIED",
        "RELEASE",
        releaseId,
      );
      throw resourceNotFound();
    }

    await this.recordAudit(
      context,
      "DEPLOYMENT_WRITE",
      "ALLOWED",
      "RELEASE_ACCESS_ALLOWED",
      "RELEASE",
      releaseId,
    );
  }

  private async recordAudit(
    credential: CredentialRow | Extract<
      TenantAuthorizationContext,
      { readonly provider: "POSTGRES" }
    >,
    permission: TenantPermission,
    outcome: "ALLOWED" | "DENIED",
    reason: string,
    resourceType?: string,
    resourceIdentifier?: string,
  ): Promise<void> {
    const tenantId = "tenant_id" in credential
      ? credential.tenant_id
      : credential.tenantId;
    const credentialId = "credential_id" in credential
      ? credential.credential_id
      : credential.credentialId;

    await this.pool.query(
      `INSERT INTO tenant_authorization_audit_events (
         authorization_audit_event_id,
         tenant_id,
         credential_id,
         permission,
         outcome,
         reason,
         resource_type,
         resource_identifier
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        tenantId,
        credentialId,
        permission,
        outcome,
        reason,
        resourceType ?? null,
        resourceIdentifier ?? null,
      ],
    );
  }
}
