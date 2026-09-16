import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HttpCustomerLeadNotifier,
} from "../src/qualified-lead-notifier.js";

test("sends bounded idempotent received and qualified email requests", async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const notifier = new HttpCustomerLeadNotifier({
    url: new URL("https://notifications.example.test/qualified-leads"),
    apiKey: "notification-key-that-is-not-exposed",
    recipient: "operator@example.test",
  }, {
    fetchImplementation: (input, init) => {
      requests.push({ input: String(input), ...(init === undefined ? {} : { init }) });
      return Promise.resolve(new Response(null, { status: 202 }));
    },
  });

  await notifier.notify({
    event: "RECEIVED",
    leadId: "123e4567-e89b-42d3-a456-426614174000",
    occurredAt: "2026-09-08T20:00:00.000Z",
  });
  await notifier.notify({
    event: "QUALIFIED",
    leadId: "123e4567-e89b-42d3-a456-426614174000",
    occurredAt: "2026-09-08T20:05:00.000Z",
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.input, "https://notifications.example.test/qualified-leads");
  const receivedHeaders = new Headers(requests[0]?.init?.headers);
  assert.equal(
    receivedHeaders.get("idempotency-key"),
    "customer-lead:received:123e4567-e89b-42d3-a456-426614174000",
  );
  assert.equal(receivedHeaders.get("authorization"), "Bearer notification-key-that-is-not-exposed");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    recipient: "operator@example.test",
    subject: "New CanaryGuard customer request",
    text:
      "Customer request 123e4567-e89b-42d3-a456-426614174000 was received at 2026-09-08T20:00:00.000Z. Open the protected CanaryGuard management dashboard to review it.",
  });
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    recipient: "operator@example.test",
    subject: "CanaryGuard customer request qualified",
    text:
      "Customer request 123e4567-e89b-42d3-a456-426614174000 was qualified at 2026-09-08T20:05:00.000Z. Open the protected CanaryGuard management dashboard to continue.",
  });
});

test("does not expose relay response content on failure", async () => {
  const notifier = new HttpCustomerLeadNotifier({
    url: new URL("https://notifications.example.test/qualified-leads"),
    apiKey: "notification-key-that-is-not-exposed",
    recipient: "operator@example.test",
  }, {
    fetchImplementation: () => Promise.resolve(
      new Response("sensitive provider response", { status: 500 }),
    ),
  });

  await assert.rejects(
    notifier.notify({
      event: "RECEIVED",
      leadId: "123e4567-e89b-42d3-a456-426614174000",
      occurredAt: "2026-09-08T20:00:00.000Z",
    }),
    (error: unknown) =>
      error instanceof Error
      && !error.message.includes("sensitive provider response"),
  );
});
