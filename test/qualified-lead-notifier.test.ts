import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HttpQualifiedLeadNotifier,
} from "../src/qualified-lead-notifier.js";

test("sends a bounded idempotent qualified-lead email request", async () => {
  let request: { input: string; init?: RequestInit } | undefined;
  const notifier = new HttpQualifiedLeadNotifier({
    url: new URL("https://notifications.example.test/qualified-leads"),
    apiKey: "notification-key-that-is-not-exposed",
    recipient: "operator@example.test",
  }, {
    fetchImplementation: (input, init) => {
      request = { input: String(input), ...(init === undefined ? {} : { init }) };
      return Promise.resolve(new Response(null, { status: 202 }));
    },
  });

  await notifier.notify({
    leadId: "123e4567-e89b-42d3-a456-426614174000",
    occurredAt: "2026-09-08T20:00:00.000Z",
  });

  assert.equal(request?.input, "https://notifications.example.test/qualified-leads");
  const headers = new Headers(request?.init?.headers);
  assert.equal(
    headers.get("idempotency-key"),
    "qualified-lead:123e4567-e89b-42d3-a456-426614174000",
  );
  assert.equal(headers.get("authorization"), "Bearer notification-key-that-is-not-exposed");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    recipient: "operator@example.test",
    subject: "CanaryGuard customer request qualified",
    text:
      "Customer request 123e4567-e89b-42d3-a456-426614174000 was qualified at 2026-09-08T20:00:00.000Z. Open the protected CanaryGuard management dashboard to continue.",
  });
});

test("does not expose relay response content on failure", async () => {
  const notifier = new HttpQualifiedLeadNotifier({
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
      leadId: "123e4567-e89b-42d3-a456-426614174000",
      occurredAt: "2026-09-08T20:00:00.000Z",
    }),
    (error: unknown) =>
      error instanceof Error
      && !error.message.includes("sensitive provider response"),
  );
});
