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
  const pool = {
    query: (text: string, values: readonly unknown[]) => {
      assert.match(text, /INSERT INTO customer_leads/u);
      valuesSeen = values;
      return Promise.resolve({
        rows: [{
          lead_id: leadId,
          status: "NEW",
          submitted_at: submittedAt,
        }],
      });
    },
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
