import assert from "node:assert/strict";
import {
  createHash,
} from "node:crypto";
import type {
  IncomingMessage,
} from "node:http";
import {
  test,
} from "node:test";
import type {
  Pool,
} from "pg";

import {
  PostgresTenantAuthorization,
} from "../../src/authorization/postgres-tenant-authorization.js";
import {
  HttpError,
} from "../../src/middleware/http-error.js";
import {
  allowLegacyTenantResources,
} from "../../src/authorization/tenant-authorization.js";

const apiKey = "t".repeat(48);
const apiKeyDigest = createHash("sha256")
  .update(apiKey, "utf8")
  .digest("hex");
const tenantId =
  "123e4567-e89b-42d3-a456-426614174000";
const credentialId =
  "223e4567-e89b-42d3-a456-426614174000";

function requestWithBearer(token: string): IncomingMessage {
  return {
    headers: {
      authorization: `Bearer ${token}`,
    },
  } as unknown as IncomingMessage;
}

function createPool(
  repositoryAllowed = true,
  role: "ADMIN" | "AUTOMATION" | "VIEWER" = "VIEWER",
): Pool {
  return {
    query: (text: string, values?: readonly unknown[]) => {
      if (text.includes("FROM tenant_api_credentials")) {
        assert.deepEqual(values, [apiKeyDigest]);
        return Promise.resolve({
          rows: [{
            credential_id: credentialId,
            tenant_id: tenantId,
            role,
          }],
          rowCount: 1,
        });
      }

      if (text.includes("FROM tenant_repository_access")) {
        return Promise.resolve({
          rows: repositoryAllowed
            ? [{ authorized: true }]
            : [],
          rowCount: repositoryAllowed ? 1 : 0,
        });
      }

      if (text.includes("INSERT INTO tenant_authorization_audit_events")) {
        assert.equal(values?.includes(apiKey), false);
        assert.equal(values?.length, 8);
        return Promise.resolve({
          rows: [],
          rowCount: 1,
        });
      }

      throw new Error(`Unexpected SQL: ${text}`);
    },
  } as unknown as Pool;
}

test("authenticates a tenant credential without storing the raw token", async () => {
  const authorization =
    new PostgresTenantAuthorization(
      createPool(),
    );

  assert.deepEqual(
    await authorization.authenticateRequest(
      requestWithBearer(apiKey),
      "REPORT_READ",
    ),
    {
      provider: "POSTGRES",
      tenantId,
      credentialId,
      role: "VIEWER",
    },
  );
});

test("denies a role without the requested permission", async () => {
  const authorization =
    new PostgresTenantAuthorization(
      createPool(),
    );

  await assert.rejects(
    authorization.authenticateRequest(
      requestWithBearer(apiKey),
      "REVIEW_WRITE",
    ),
    (error: unknown) =>
      error instanceof HttpError
      && error.statusCode === 403
      && error.code === "FORBIDDEN",
  );
});

test("conceals repositories outside the authenticated tenant", async () => {
  const authorization =
    new PostgresTenantAuthorization(
      createPool(false),
    );
  const context =
    await authorization.authenticateRequest(
      requestWithBearer(apiKey),
      "REPORT_READ",
    );

  await assert.rejects(
    authorization.assertRepositoryAccess(
      context,
      {
        owner: "OTHER",
        name: "private-repository",
      },
    ),
    (error: unknown) =>
      error instanceof HttpError
      && error.statusCode === 404
      && error.code === "RESOURCE_NOT_FOUND",
  );
});

test("permits a repository explicitly granted to the tenant", async () => {
  const authorization =
    new PostgresTenantAuthorization(
      createPool(true),
    );
  const context =
    await authorization.authenticateRequest(
      requestWithBearer(apiKey),
      "REPORT_READ",
    );

  await authorization.assertRepositoryAccess(
    context,
    {
      owner: "RWAMBA",
      name: "the-autonomous-canary",
    },
  );
});

test("allows automation credentials to write reviews and deployments", async () => {
  const authorization = new PostgresTenantAuthorization(
    createPool(true, "AUTOMATION"),
  );

  for (const permission of [
    "REVIEW_WRITE",
    "DEPLOYMENT_WRITE",
    "REPORT_READ",
  ] as const) {
    const context = await authorization.authenticateRequest(
      requestWithBearer(apiKey),
      permission,
    );
    assert.equal(context.role, "AUTOMATION");
  }
});

test("conceals releases outside the authenticated tenant", async () => {
  const pool = {
    query: (text: string) => {
      if (text.includes("FROM tenant_repository_access")) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (text.includes("INSERT INTO tenant_authorization_audit_events")) {
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  } as unknown as Pool;
  const authorization = new PostgresTenantAuthorization(pool);

  await assert.rejects(
    authorization.assertReleaseAccess(
      {
        provider: "POSTGRES",
        tenantId,
        credentialId,
        role: "AUTOMATION",
      },
      tenantId,
    ),
    (error: unknown) =>
      error instanceof HttpError
      && error.statusCode === 404
      && error.code === "RESOURCE_NOT_FOUND",
  );
});

test("fails closed when PostgreSQL identity reaches an unwired controller", async () => {
  await assert.rejects(
    allowLegacyTenantResources.assertRepositoryAccess(
      {
        provider: "POSTGRES",
        tenantId,
        credentialId,
        role: "VIEWER",
      },
      {
        owner: "RWAMBA",
        name: "the-autonomous-canary",
      },
    ),
    /requires a resource authorizer/u,
  );
});
