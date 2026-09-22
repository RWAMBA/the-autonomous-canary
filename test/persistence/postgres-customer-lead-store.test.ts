import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { Pool } from "pg";

import {
  PostgresCustomerLeadStore,
} from "../../src/persistence/postgres-customer-lead-store.js";

const leadId =
  "123e4567-e89b-42d3-a456-426614174000";
const submittedAt =
  "2026-09-08T20:00:00.000Z";
const submissionToken =
  "223e4567-e89b-42d3-a456-426614174000";

function newLead() {
  return {
    leadId,
    contactName: "Valerie Monet",
    workEmail: "valerie@example.com",
    organizationName: "RWAMBA",
    service: "RELEASE_RISK_ASSESSMENT",
    repositoryOwner: "RWAMBA",
    repositoryName: "the-autonomous-canary",
    challenge:
      "We need an evidence-backed assessment of our release process.",
    consentedAt: submittedAt,
    submissionToken,
    submittedAt,
  };
}

test("stores a lead with token and payload digests instead of the raw token", async () => {
  let valuesSeen: readonly unknown[] = [];
  const statements: string[] = [];
  const query = (text: string, values: readonly unknown[] = []) => {
    statements.push(text.replace(/\s+/gu, " ").trim());
    if (text.includes("INSERT INTO customer_leads")) {
      valuesSeen = values;
      return Promise.resolve({
        rows: [{
          lead_id: leadId,
          status: "NEW",
          submitted_at: submittedAt,
        }],
      });
    }
    if (text.includes("COUNT(*)") && text.includes("customer_leads")) {
      return Promise.resolve({ rows: [{ recent_total: "0", recent_email: "0" }] });
    }
    return Promise.resolve({ rows: [] });
  };
  const client = {
    query,
    release: () => undefined,
  };
  const pool = {
    query,
    connect: () => Promise.resolve(client),
  } as unknown as Pool;

  assert.deepEqual(
    await new PostgresCustomerLeadStore(pool).createLead(newLead()),
    { leadId, status: "NEW", submittedAt },
  );
  assert.equal(valuesSeen.includes(submissionToken), false);
  assert.equal(
    valuesSeen.includes(
      createHash("sha256").update(submissionToken).digest("hex"),
    ),
    true,
  );
  assert.equal(statements[0], "BEGIN");
  assert.match(statements.join("\n"), /INSERT INTO customer_lead_notifications/u);
  assert.equal(statements.at(-1), "COMMIT");
});

test("rejects an over-quota new lead before persistence and rolls back", async () => {
  const statements: string[] = [];
  const client = {
    query: (text: string) => {
      statements.push(text);
      if (text.includes("SELECT lead_id, status, submitted_at, payload_sha256")) {
        return Promise.resolve({ rows: [] });
      }
      if (text.includes("COUNT(*)") && text.includes("customer_leads")) {
        return Promise.resolve({ rows: [{ recent_total: "120", recent_email: "0" }] });
      }
      return Promise.resolve({ rows: [] });
    },
    release: () => undefined,
  };
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;

  await assert.rejects(
    new PostgresCustomerLeadStore(pool).createLead(newLead()),
    (error: unknown) => error instanceof Error && "statusCode" in error
      && error.statusCode === 429,
  );
  assert.equal(statements.some((statement) => statement.includes("INSERT INTO customer_leads")), false);
  assert.equal(statements.at(-1), "ROLLBACK");
});

test("applies the per-email quota across instances while preserving token retries", async () => {
  const statements: string[] = [];
  let existing = false;
  const client = {
    query: (text: string) => {
      statements.push(text);
      if (text.includes("SELECT lead_id, status, submitted_at, payload_sha256")) {
        return Promise.resolve({ rows: existing ? [{
          lead_id: leadId,
          status: "NEW",
          submitted_at: submittedAt,
          payload_sha256: createHash("sha256").update(JSON.stringify({
            contactName: newLead().contactName,
            workEmail: newLead().workEmail,
            organizationName: newLead().organizationName,
            service: newLead().service,
            repositoryOwner: newLead().repositoryOwner,
            repositoryName: newLead().repositoryName,
            challenge: newLead().challenge,
          })).digest("hex"),
        }] : [] });
      }
      if (text.includes("COUNT(*)") && text.includes("customer_leads")) {
        return Promise.resolve({ rows: [{ recent_total: "1", recent_email: "3" }] });
      }
      return Promise.resolve({ rows: [] });
    },
    release: () => undefined,
  };
  const pool = { connect: () => Promise.resolve(client) } as unknown as Pool;
  const store = new PostgresCustomerLeadStore(pool);
  await assert.rejects(store.createLead(newLead()), (error: unknown) =>
    error instanceof Error && "statusCode" in error && error.statusCode === 429);
  existing = true;
  assert.deepEqual(await store.createLead(newLead()), {
    leadId, status: "NEW", submittedAt,
  });
  assert.equal(statements.filter((sql) => sql.includes("INSERT INTO customer_leads")).length, 0);
  assert.equal(statements.filter((sql) => sql.includes("COUNT(*)")).length, 1);
});

test("lists only bounded lead fields with parameterized filters", async () => {
  let queryText = "";
  let queryValues: readonly unknown[] = [];
  const pool = {
    query: (text: string, values: readonly unknown[]) => {
      queryText = text;
      queryValues = values;
      return Promise.resolve({
        rows: [{
          lead_id: leadId,
          contact_name: "Valerie Monet",
          work_email: "valerie@example.com",
          organization_name: "RWAMBA",
          service: "RELEASE_RISK_ASSESSMENT",
          repository_owner: "RWAMBA",
          repository_name: "the-autonomous-canary",
          challenge:
            "We need an evidence-backed assessment of our release process.",
          status: "QUALIFIED",
          submitted_at: submittedAt,
          updated_at: submittedAt,
          retention_expires_at:
            "2027-03-07T20:00:00.000Z",
        }],
      });
    },
  } as unknown as Pool;

  const result = await new PostgresCustomerLeadStore(pool).listLeads({
    status: "QUALIFIED",
    limit: 25,
  });

  assert.equal(result.leads[0]?.status, "QUALIFIED");
  assert.deepEqual(queryValues, ["QUALIFIED", 25]);
  assert.doesNotMatch(queryText, /QUALIFIED/u);
  assert.doesNotMatch(queryText, /submission_token|payload_sha256/u);
});

test("records a valid lead transition and bounded actor identity atomically", async () => {
  const statements: string[] = [];
  const client = {
    query: (text: string, values?: readonly unknown[]) => {
      statements.push(text.replace(/\s+/gu, " ").trim());
      if (text.includes("SELECT lead_id, status")) {
        return Promise.resolve({ rows: [{ lead_id: leadId, status: "NEW" }] });
      }
      if (text.includes("INSERT INTO customer_lead_status_events")) {
        assert.equal(values?.includes("secret"), false);
        assert.equal(values?.[4], "POSTGRES");
      }
      return Promise.resolve({ rows: [] });
    },
    release: () => undefined,
  };
  const pool = {
    connect: () => Promise.resolve(client),
  } as unknown as Pool;

  assert.deepEqual(
    await new PostgresCustomerLeadStore(pool).transitionLead(
      leadId,
      "QUALIFIED",
      {
        provider: "POSTGRES",
        tenantId:
          "323e4567-e89b-42d3-a456-426614174000",
        credentialId:
          "423e4567-e89b-42d3-a456-426614174000",
        role: "ADMIN",
      },
      submittedAt,
    ),
    { leadId, status: "QUALIFIED", updatedAt: submittedAt },
  );
  assert.equal(statements[0], "BEGIN");
  assert.match(statements.join("\n"), /INSERT INTO customer_lead_notifications/u);
  assert.equal(statements.at(-1), "COMMIT");
});

test("rejects skipped or terminal qualification transitions", async () => {
  let rolledBack = false;
  const client = {
    query: (text: string) => {
      if (text.includes("SELECT lead_id, status")) {
        return Promise.resolve({ rows: [{ lead_id: leadId, status: "NEW" }] });
      }
      if (text === "ROLLBACK") rolledBack = true;
      return Promise.resolve({ rows: [] });
    },
    release: () => undefined,
  };
  const pool = {
    connect: () => Promise.resolve(client),
  } as unknown as Pool;

  await assert.rejects(
    new PostgresCustomerLeadStore(pool).transitionLead(
      leadId,
      "PROPOSAL_SENT",
      { provider: "LEGACY", role: "ADMIN" },
      submittedAt,
    ),
    /cannot transition from NEW to PROPOSAL_SENT/u,
  );
  assert.equal(rolledBack, true);
});

test("reuses the stored qualification time for an idempotent transition", async () => {
  const statements: string[] = [];
  const client = {
    query: (text: string, values?: readonly unknown[]) => {
      statements.push(text.replace(/\s+/gu, " ").trim());
      if (text.includes("SELECT lead_id, status, updated_at")) {
        return Promise.resolve({
          rows: [{
            lead_id: leadId,
            status: "QUALIFIED",
            updated_at: submittedAt,
          }],
        });
      }
      if (text.includes("INSERT INTO customer_lead_notifications")) {
        assert.equal(values?.[0], `qualified-lead:${leadId}`);
        assert.equal(values?.[3], submittedAt);
      }
      return Promise.resolve({ rows: [] });
    },
    release: () => undefined,
  };
  const pool = {
    connect: () => Promise.resolve(client),
  } as unknown as Pool;

  assert.deepEqual(
    await new PostgresCustomerLeadStore(pool).transitionLead(
      leadId,
      "QUALIFIED",
      { provider: "LEGACY", role: "ADMIN" },
      "2026-09-16T17:00:00.000Z",
    ),
    { leadId, status: "QUALIFIED", updatedAt: submittedAt },
  );
  assert.doesNotMatch(statements.join("\n"), /UPDATE customer_leads SET status/u);
  assert.match(statements.join("\n"), /INSERT INTO customer_lead_notifications/u);
});

test("claims, completes, and reschedules bounded notification records", async () => {
  const statements: Array<{ text: string; values?: readonly unknown[] }> = [];
  const pool = {
    query: (text: string, values?: readonly unknown[]) => {
      statements.push({
        text: text.replace(/\s+/gu, " ").trim(),
        ...(values === undefined ? {} : { values }),
      });
      if (text.includes("WITH candidate AS")) {
        return Promise.resolve({
          rows: [{
            notification_id: `customer-lead:received:${leadId}`,
            event: "RECEIVED",
            lead_id: leadId,
            occurred_at: submittedAt,
            attempts: 2,
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    },
  } as unknown as Pool;
  const store = new PostgresCustomerLeadStore(pool);

  assert.deepEqual(
    await store.claimNotification(
      "2026-09-16T16:00:00.000Z",
      "2026-09-16T16:00:30.000Z",
    ),
    {
      notificationId: `customer-lead:received:${leadId}`,
      event: "RECEIVED",
      leadId,
      occurredAt: submittedAt,
      attempts: 2,
    },
  );
  await store.completeNotification(
    `customer-lead:received:${leadId}`,
    "2026-09-16T16:01:00.000Z",
    2,
  );
  await store.retryNotification(
    `customer-lead:received:${leadId}`,
    "2026-09-16T16:02:00.000Z",
    2,
  );

  assert.match(statements[0]?.text ?? "", /FOR UPDATE SKIP LOCKED/u);
  assert.deepEqual(statements[0]?.values, [
    "2026-09-16T16:00:00.000Z",
    "2026-09-16T16:00:30.000Z",
  ]);
  assert.match(statements[1]?.text ?? "", /SET delivered_at = \$2/u);
  assert.match(statements[2]?.text ?? "", /SET next_attempt_at = \$2/u);
  assert.match(statements[1]?.text ?? "", /AND attempts = \$3/u);
  assert.match(statements[2]?.text ?? "", /AND attempts = \$3/u);
  assert.deepEqual(statements[1]?.values, [
    `customer-lead:received:${leadId}`,
    "2026-09-16T16:01:00.000Z",
    2,
  ]);
  assert.deepEqual(statements[2]?.values, [
    `customer-lead:received:${leadId}`,
    "2026-09-16T16:02:00.000Z",
    2,
  ]);
});

test("stale notification claims cannot change the current claimant's lease", async () => {
  let attempts = 0;
  let leaseActive = false;
  let delivered = false;
  let nextAttemptAt = submittedAt;
  const pool = {
    query: (text: string, values?: readonly unknown[]) => {
      if (text.includes("WITH candidate AS")) {
        attempts += 1;
        leaseActive = true;
        return Promise.resolve({ rows: [{
          notification_id: `customer-lead:received:${leadId}`,
          event: "RECEIVED",
          lead_id: leadId,
          occurred_at: submittedAt,
          attempts,
        }] });
      }
      if (text.includes("UPDATE customer_lead_notifications")) {
        // Model PostgreSQL's atomic UPDATE predicate for the claim generation.
        if (text.includes("AND attempts = $3") && values?.[2] === attempts && !delivered) {
          leaseActive = false;
          if (text.includes("SET delivered_at")) delivered = true;
          else nextAttemptAt = String(values?.[1]);
        }
        return Promise.resolve({ rows: [] });
      }
      throw new Error("Unexpected query");
    },
  } as unknown as Pool;
  const store = new PostgresCustomerLeadStore(pool);
  const first = await store.claimNotification(submittedAt, "2026-09-16T16:00:30.000Z");
  const second = await store.claimNotification("2026-09-16T16:00:31.000Z", "2026-09-16T16:01:01.000Z");
  assert.equal(first?.attempts, 1);
  assert.equal(second?.attempts, 2);

  await store.retryNotification(`customer-lead:received:${leadId}`, "2026-09-16T17:00:00.000Z", first!.attempts);
  await store.completeNotification(`customer-lead:received:${leadId}`, "2026-09-16T16:00:32.000Z", first!.attempts);
  assert.equal(leaseActive, true);
  assert.equal(delivered, false);
  assert.equal(nextAttemptAt, submittedAt);

  await store.completeNotification(`customer-lead:received:${leadId}`, "2026-09-16T16:00:33.000Z", second!.attempts);
  assert.equal(delivered, true);
});
