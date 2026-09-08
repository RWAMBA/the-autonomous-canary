import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseCustomerLeadSubmission,
  parseCustomerLeadListQuery,
  parseCustomerLeadTransition,
} from "../../src/dto/customer-lead.js";

const submission = {
  contactName: "  Valerie Monet  ",
  workEmail: "VALERIE@example.com",
  organizationName: "  RWAMBA  ",
  service: "RELEASE_RISK_ASSESSMENT",
  repositoryOwner: "RWAMBA",
  repositoryName: "the-autonomous-canary",
  challenge:
    "We need an evidence-backed release-risk assessment before production rollout.",
  consent: true,
  submissionToken:
    "123e4567-e89b-42d3-a456-426614174000",
  website: "",
};

test("normalizes a bounded acquisition request", () => {
  assert.deepEqual(
    parseCustomerLeadSubmission(submission),
    {
      ...submission,
      contactName: "Valerie Monet",
      workEmail: "valerie@example.com",
      organizationName: "RWAMBA",
    },
  );
});

test("requires repository identity to be supplied as a complete pair", () => {
  assert.throws(() => parseCustomerLeadSubmission({
    ...submission,
    repositoryName: undefined,
  }));
});

test("rejects credential-shaped content instead of retaining it as a lead", () => {
  assert.throws(() => parseCustomerLeadSubmission({
    ...submission,
    challenge:
      `Please inspect github_pat_${"a".repeat(32)} before deployment.`,
  }));
});

test("parses bounded qualification queries and transitions", () => {
  assert.deepEqual(
    parseCustomerLeadListQuery(new URLSearchParams({
      status: "QUALIFIED",
      limit: "50",
    })),
    { status: "QUALIFIED", limit: 50 },
  );
  assert.deepEqual(
    parseCustomerLeadTransition({ status: "PROPOSAL_SENT" }),
    { status: "PROPOSAL_SENT" },
  );
  assert.throws(() => parseCustomerLeadTransition({ status: "NEW" }));
});
