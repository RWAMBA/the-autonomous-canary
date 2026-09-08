import {
  createHash,
  randomUUID,
} from "node:crypto";
import {
  z,
} from "zod";

import {
  createPostgresPool,
} from "../src/persistence/postgres-release-lifecycle-store.js";
import {
  loadPersistenceConfig,
} from "../src/persistence/persistence-config.js";
import {
  repositoryPartSchema,
} from "../src/dto/review-request.js";

const inputSchema = z.object({
  tenantSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/u),
  tenantDisplayName: z.string().trim().min(1).max(200),
  credentialName: z.string().trim().min(1).max(100),
  credentialRole: z.enum(["ADMIN", "AUTOMATION", "VIEWER"]),
  tenantApiKey: z.string().min(32).max(512).refine(
    (value) => value.trim() === value && !/[\s,]/u.test(value),
    "CANARYGUARD_TENANT_API_KEY must be one non-whitespace token.",
  ),
  repositoryOwner: repositoryPartSchema,
  repositoryName: repositoryPartSchema,
}).strict();

const input = inputSchema.parse({
  tenantSlug: process.env.CANARYGUARD_TENANT_SLUG,
  tenantDisplayName: process.env.CANARYGUARD_TENANT_DISPLAY_NAME,
  credentialName: process.env.CANARYGUARD_TENANT_CREDENTIAL_NAME,
  credentialRole: process.env.CANARYGUARD_TENANT_CREDENTIAL_ROLE,
  tenantApiKey: process.env.CANARYGUARD_TENANT_API_KEY,
  repositoryOwner: process.env.CANARYGUARD_REPOSITORY_OWNER,
  repositoryName: process.env.CANARYGUARD_REPOSITORY_NAME,
});
const persistence = loadPersistenceConfig();

if (persistence.provider !== "POSTGRES") {
  throw new Error(
    "CANARYGUARD_PERSISTENCE_PROVIDER=POSTGRES is required to provision a tenant.",
  );
}

const pool = createPostgresPool(persistence);
const client = await pool.connect();
const tenantId = randomUUID();
const credentialId = randomUUID();
const keyDigest = createHash("sha256")
  .update(input.tenantApiKey, "utf8")
  .digest("hex");

try {
  await client.query("BEGIN");
  const tenant = await client.query<{ tenant_id: string }>(
    `INSERT INTO tenants (
       tenant_id,
       slug,
       display_name
     ) VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE
     SET display_name = EXCLUDED.display_name,
         updated_at = now()
     RETURNING tenant_id`,
    [tenantId, input.tenantSlug, input.tenantDisplayName],
  );
  const resolvedTenantId = tenant.rows[0]?.tenant_id;

  if (resolvedTenantId === undefined) {
    throw new Error("Tenant provisioning did not return a tenant identifier.");
  }

  const repository = await client.query<{ repository_id: string }>(
    `SELECT repository_id::text
     FROM repositories
     WHERE lower(owner) = lower($1)
       AND lower(name) = lower($2)
     LIMIT 1`,
    [input.repositoryOwner, input.repositoryName],
  );
  const repositoryId = repository.rows[0]?.repository_id;

  if (repositoryId === undefined) {
    throw new Error(
      "The repository must exist before tenant access can be granted.",
    );
  }

  await client.query(
    `INSERT INTO tenant_repository_access (
       tenant_id,
       repository_id
     ) VALUES ($1, $2)
     ON CONFLICT (tenant_id, repository_id) DO NOTHING`,
    [resolvedTenantId, repositoryId],
  );

  await client.query(
    `INSERT INTO tenant_api_credentials (
       credential_id,
       tenant_id,
       name,
       key_sha256,
       role
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      credentialId,
      resolvedTenantId,
      input.credentialName,
      keyDigest,
      input.credentialRole,
    ],
  );
  await client.query("COMMIT");

  console.log(JSON.stringify({
    tenantId: resolvedTenantId,
    credentialId,
    role: input.credentialRole,
    repository: {
      owner: input.repositoryOwner,
      name: input.repositoryName,
    },
  }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
