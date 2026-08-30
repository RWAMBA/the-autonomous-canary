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
