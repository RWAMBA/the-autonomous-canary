import assert from "node:assert/strict";
import { test } from "node:test";

import {
  customerAcquisitionAdminTenantEnvironmentVariable,
  customerAcquisitionProviderEnvironmentVariable,
  loadCustomerAcquisitionConfig,
  qualifiedLeadNotificationApiKeyEnvironmentVariable,
  qualifiedLeadNotificationRecipientEnvironmentVariable,
  qualifiedLeadNotificationUrlEnvironmentVariable,
} from "../src/customer-acquisition-config.js";

test("keeps customer acquisition disabled by default", () => {
  assert.deepEqual(loadCustomerAcquisitionConfig({}), {
    provider: "DISABLED",
  });
});

test("enables the PostgreSQL customer-acquisition boundary explicitly", () => {
  const adminTenantId =
    "223e4567-e89b-42d3-a456-426614174000";
  const notificationApiKey = "n".repeat(32);
  assert.deepEqual(loadCustomerAcquisitionConfig({
    [customerAcquisitionProviderEnvironmentVariable]: "POSTGRES",
    [customerAcquisitionAdminTenantEnvironmentVariable]: adminTenantId,
    [qualifiedLeadNotificationUrlEnvironmentVariable]:
      "https://notifications.example.test/qualified-leads",
    [qualifiedLeadNotificationApiKeyEnvironmentVariable]: notificationApiKey,
    [qualifiedLeadNotificationRecipientEnvironmentVariable]:
      "operator@example.test",
  }), {
    provider: "POSTGRES",
    adminTenantId,
    qualifiedLeadNotification: {
      url: new URL("https://notifications.example.test/qualified-leads"),
      apiKey: notificationApiKey,
      recipient: "operator@example.test",
    },
  });
  assert.throws(() => loadCustomerAcquisitionConfig({
    [customerAcquisitionProviderEnvironmentVariable]: "ENABLED",
  }));
  assert.throws(() => loadCustomerAcquisitionConfig({
    [customerAcquisitionProviderEnvironmentVariable]: "POSTGRES",
  }));
  assert.throws(() => loadCustomerAcquisitionConfig({
    [customerAcquisitionProviderEnvironmentVariable]: "POSTGRES",
    [customerAcquisitionAdminTenantEnvironmentVariable]: adminTenantId,
    [qualifiedLeadNotificationUrlEnvironmentVariable]:
      "http://notifications.example.test/qualified-leads",
    [qualifiedLeadNotificationApiKeyEnvironmentVariable]: notificationApiKey,
    [qualifiedLeadNotificationRecipientEnvironmentVariable]:
      "operator@example.test",
  }));
});
