import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DefaultCustomerLeadController,
} from "../../src/controllers/customer-lead-controller.js";
import type {
  CustomerLeadStore,
} from "../../src/persistence/customer-lead-store.js";

const leadId =
  "123e4567-e89b-42d3-a456-426614174000";
const submittedAt =
  "2026-09-08T20:00:00.000Z";
const context = {
  provider: "POSTGRES" as const,
  tenantId:
    "223e4567-e89b-42d3-a456-426614174000",
  credentialId:
    "323e4567-e89b-42d3-a456-426614174000",
  role: "ADMIN" as const,
};

function input(website = "") {
  return {
    contactName: "Valerie Monet",
    workEmail: "valerie@example.com",
    organizationName: "RWAMBA",
    service: "MANAGED_DEPLOYMENT",
    challenge:
      "We need a managed GitHub App installation and deployment evidence.",
    consent: true,
    submissionToken:
      "423e4567-e89b-42d3-a456-426614174000",
    website,
  };
}

test("persists a validated lead and returns only its receipt", async () => {
  let created: unknown;
  const store = {
    createLead: (lead) => {
      created = lead;
      return Promise.resolve({
        leadId,
        status: "NEW" as const,
        submittedAt,
      });
    },
    listLeads: () => Promise.resolve({ leads: [] }),
    transitionLead: () => Promise.reject(new Error("not used")),
  } satisfies CustomerLeadStore;
  const controller = new DefaultCustomerLeadController(store, {
    createLeadId: () => leadId,
    now: () => new Date(submittedAt),
    adminTenantId: context.tenantId,
  });

  assert.deepEqual(await controller.submitLead(input()), {
    leadId,
    status: "RECEIVED",
    submittedAt,
  });
  assert.deepEqual(created, {
    leadId,
    contactName: "Valerie Monet",
    workEmail: "valerie@example.com",
    organizationName: "RWAMBA",
    service: "MANAGED_DEPLOYMENT",
    challenge:
      "We need a managed GitHub App installation and deployment evidence.",
    consentedAt: submittedAt,
    submissionToken:
      "423e4567-e89b-42d3-a456-426614174000",
    submittedAt,
  });
});

test("rejects another tenant administrator before acquisition data is read", async () => {
  let listCalls = 0;
  const store = {
    createLead: () => Promise.reject(new Error("not used")),
    listLeads: () => {
      listCalls += 1;
      return Promise.resolve({ leads: [] });
    },
    transitionLead: () => Promise.reject(new Error("not used")),
  } satisfies CustomerLeadStore;
  const controller = new DefaultCustomerLeadController(store, {
    adminTenantId: "423e4567-e89b-42d3-a456-426614174000",
  });

  await assert.rejects(
    controller.listLeads(new URLSearchParams(), context),
    (error: unknown) =>
      error instanceof Error
      && "statusCode" in error
      && error.statusCode === 403,
  );
  assert.equal(listCalls, 0);
});

test("silently discards honeypot submissions", async () => {
  let createCalls = 0;
  const store = {
    createLead: () => {
      createCalls += 1;
      throw new Error("must not persist");
    },
    listLeads: () => Promise.resolve({ leads: [] }),
    transitionLead: () => Promise.reject(new Error("not used")),
  } satisfies CustomerLeadStore;
  const controller = new DefaultCustomerLeadController(store, {
    createLeadId: () => leadId,
    now: () => new Date(submittedAt),
    adminTenantId: context.tenantId,
  });

  assert.deepEqual(await controller.submitLead(input("bot.example")), {
    leadId,
    status: "RECEIVED",
    submittedAt,
  });
  assert.equal(createCalls, 0);
});

test("records an ADMIN qualification transition without free-form notes", async () => {
  let actor: unknown;
  let notification: unknown;
  const store = {
    createLead: () => Promise.reject(new Error("not used")),
    listLeads: () => Promise.resolve({ leads: [] }),
    transitionLead: (_leadId, status, authorizationContext, occurredAt) => {
      actor = { status, authorizationContext, occurredAt };
      return Promise.resolve({
        leadId,
        status,
        updatedAt: occurredAt,
      });
    },
  } satisfies CustomerLeadStore;
  const controller = new DefaultCustomerLeadController(store, {
    createLeadId: () => leadId,
    now: () => new Date(submittedAt),
    adminTenantId: context.tenantId,
    qualifiedLeadNotifier: {
      notify: (value) => {
        notification = value;
        return Promise.resolve();
      },
    },
  });

  assert.deepEqual(
    await controller.transitionLead(
      leadId,
      { status: "QUALIFIED" },
      context,
    ),
    { leadId, status: "QUALIFIED", updatedAt: submittedAt },
  );
  assert.deepEqual(actor, {
    status: "QUALIFIED",
    authorizationContext: context,
    occurredAt: submittedAt,
  });
  assert.deepEqual(notification, {
    leadId,
    occurredAt: submittedAt,
  });
});
