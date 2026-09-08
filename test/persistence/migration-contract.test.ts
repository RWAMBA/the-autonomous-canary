import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";
import {
  test,
} from "node:test";

const migrationUrl = new URL(
  "../../db/migrations/001_release_lifecycle.sql",
  import.meta.url,
);

const deploymentEventMigrationUrl =
  new URL(
    "../../db/migrations/002_deployment_event_ingestion.sql",
    import.meta.url,
  );

const managementReportingMigrationUrl =
  new URL(
    "../../db/migrations/003_management_reporting.sql",
    import.meta.url,
  );

const externalEvidenceMigrationUrl =
  new URL(
    "../../db/migrations/004_external_evidence_attribution.sql",
    import.meta.url,
  );

const accessibilityEvidenceMigrationUrl =
  new URL(
    "../../db/migrations/005_accessibility_evidence_attribution.sql",
    import.meta.url,
  );

const accessibilityEvidenceRollbackUrl =
  new URL(
    "../../db/rollbacks/005_accessibility_evidence_attribution.sql",
    import.meta.url,
  );

const tenantAuthorizationMigrationUrl =
  new URL(
    "../../db/migrations/006_tenant_authorization_foundation.sql",
    import.meta.url,
  );

test("defines the complete release lifecycle under one release identifier", async () => {
  const migration = await readFile(
    migrationUrl,
    "utf8",
  );

  for (const table of [
    "repositories",
    "pull_requests",
    "releases",
    "webhook_deliveries",
    "workflow_runs",
    "automation_tasks",
    "review_predictions",
    "deterministic_findings",
    "model_assessments",
    "policy_decisions",
    "deployment_attempts",
    "canary_observations",
    "release_outcomes",
    "audit_events",
    "policy_change_proposals",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `CREATE TABLE IF NOT EXISTS ${table}`,
        "u",
      ),
    );
  }

  assert.match(
    migration,
    /CREATE OR REPLACE VIEW release_prediction_accuracy/u,
  );
  assert.match(
    migration,
    /status = 'PENDING' AND decided_at IS NULL/u,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS repositories_owner_name_ci_idx\s+ON repositories \(lower\(owner\), lower\(name\)\)/u,
  );
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS audit_events[\s\S]*?release_id uuid NOT NULL REFERENCES releases\(release_id\)/u,
  );
  assert.doesNotMatch(
    migration,
    /raw_(?:log|prompt|model|diff)|api_key|private_key/iu,
  );
});

test("adds durable deployment event idempotency without raw payload storage", async () => {
  const migration = await readFile(
    deploymentEventMigrationUrl,
    "utf8",
  );

  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS deployment_event_receipts/u,
  );
  assert.match(
    migration,
    /event_id uuid PRIMARY KEY/u,
  );
  assert.match(
    migration,
    /release_id uuid NOT NULL REFERENCES releases\(release_id\)/u,
  );
  assert.match(
    migration,
    /payload_sha256 text NOT NULL/u,
  );
  assert.match(
    migration,
    /002_deployment_event_ingestion/u,
  );
  assert.doesNotMatch(
    migration,
    /raw_(?:payload|log|prompt|model|diff)|api_key|private_key/iu,
  );
});

test("adds reporting indexes without duplicating lifecycle data", async () => {
  const migration = await readFile(
    managementReportingMigrationUrl,
    "utf8",
  );

  for (const index of [
    "releases_repository_created_release_idx",
    "workflow_runs_release_created_idx",
    "deterministic_findings_release_finding_idx",
    "deployment_attempts_release_started_idx",
    "canary_observations_attempt_observed_idx",
    "audit_events_release_occurred_idx",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `CREATE INDEX IF NOT EXISTS ${index}`,
        "u",
      ),
    );
  }

  assert.match(
    migration,
    /003_management_reporting/u,
  );
  assert.doesNotMatch(
    migration,
    /CREATE TABLE|raw_(?:payload|log|prompt|model|diff)|api_key|private_key/iu,
  );
});

test("adds bounded external evidence attribution without raw report storage", async () => {
  const migration = await readFile(
    externalEvidenceMigrationUrl,
    "utf8",
  );

  for (const column of [
    "evidence_source",
    "evidence_source_version",
    "evidence_identifier",
    "evidence_category",
    "evidence_generated_at",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `ADD COLUMN IF NOT EXISTS ${column}`,
        "u",
      ),
    );
  }

  assert.match(
    migration,
    /004_external_evidence_attribution/u,
  );
  assert.match(
    migration,
    /conrelid = 'deterministic_findings'::regclass/u,
  );

  for (const requiredColumn of [
    "evidence_source",
    "evidence_source_version",
    "evidence_identifier",
    "evidence_category",
    "evidence_generated_at",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `${requiredColumn} IS NOT NULL`,
        "u",
      ),
    );
  }

  assert.doesNotMatch(
    migration,
    /raw_(?:report|payload|log|prompt|model|diff)|api_key|private_key/iu,
  );
});

test("extends attribution only for normalized Axe accessibility evidence", async () => {
  const migration = await readFile(
    accessibilityEvidenceMigrationUrl,
    "utf8",
  );

  assert.match(
    migration,
    /DROP CONSTRAINT IF EXISTS deterministic_findings_evidence_attribution_check/u,
  );
  assert.match(
    migration,
    /evidence_source = 'AXE'/u,
  );
  assert.match(
    migration,
    /evidence_category = 'ACCESSIBILITY_VIOLATION'/u,
  );
  assert.match(
    migration,
    /005_accessibility_evidence_attribution/u,
  );
  assert.match(
    migration,
    /IF NOT EXISTS[\s\S]+WHERE version = '005_accessibility_evidence_attribution'/u,
  );
  assert.doesNotMatch(
    migration,
    /raw_(?:payload|report|html|selector|remediation)|api_key|private_key/iu,
  );
});

test("prepares a finding-preserving rollback for the previous reader", async () => {
  const rollback = await readFile(
    accessibilityEvidenceRollbackUrl,
    "utf8",
  );

  assert.match(
    rollback,
    /UPDATE deterministic_findings[\s\S]+WHERE evidence_source = 'AXE'/u,
  );
  assert.match(
    rollback,
    /pg_advisory_xact_lock\(1548624771\)/u,
  );
  assert.match(
    rollback,
    /evidence_source = NULL/u,
  );
  assert.match(
    rollback,
    /evidence_source IS NOT NULL[\s\S]+evidence_source = 'TRIVY'/u,
  );
  assert.match(
    rollback,
    /evidence_category IS NOT NULL[\s\S]+evidence_category IN/u,
  );
  assert.match(
    rollback,
    /DELETE FROM schema_migrations[\s\S]+005_accessibility_evidence_attribution/u,
  );
  assert.doesNotMatch(
    rollback,
    /DELETE FROM deterministic_findings/iu,
  );
});

test("adds tenant-scoped credential authorization without storing raw secrets", async () => {
  const migration = await readFile(
    tenantAuthorizationMigrationUrl,
    "utf8",
  );

  for (const table of [
    "tenants",
    "tenant_api_credentials",
    "tenant_repository_access",
    "tenant_authorization_audit_events",
  ]) {
    assert.match(
      migration,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, "u"),
    );
  }

  assert.match(migration, /key_sha256 char\(64\) NOT NULL UNIQUE/u);
  assert.match(migration, /role IN \('ADMIN', 'AUTOMATION', 'VIEWER'\)/u);
  assert.match(migration, /permission IN \('REVIEW_WRITE', 'DEPLOYMENT_WRITE', 'REPORT_READ'\)/u);
  assert.match(migration, /PRIMARY KEY \(tenant_id, repository_id\)/u);
  assert.match(migration, /006_tenant_authorization_foundation/u);
  assert.doesNotMatch(
    migration,
    /raw_(?:credential|secret|token)|private_key|key_value/iu,
  );
});
