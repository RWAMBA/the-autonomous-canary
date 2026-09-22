import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpCustomerLeadNotifier } from "../src/qualified-lead-notifier.ts";
import worker from "./worker.mjs";

test("existing Render notifier sends both event formats through the relay", async () => {
  const env = {
    RELAY_API_KEY: "x".repeat(48),
    RESEND_API_KEY: "re_local_test",
    NOTIFICATION_RECIPIENT: "operator@example.com",
    MAIL_FROM: "CanaryGuard <alerts@example.com>",
  };
  const sent = [];
  const notifier = new HttpCustomerLeadNotifier({
    url: new URL("https://relay.example.com/notify"),
    apiKey: env.RELAY_API_KEY,
    recipient: env.NOTIFICATION_RECIPIENT,
  }, {
    fetchImplementation: (url, init) => worker.fetch(new Request(url, init), env, {
      fetchImplementation: async (_url, init) => {
        sent.push(init);
        return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
      },
    }),
  });
  for (const event of ["RECEIVED", "QUALIFIED"]) {
    await notifier.notify({
      event,
      leadId: "123e4567-e89b-42d3-a456-426614174000",
      occurredAt: "2026-09-22T16:00:00.000Z",
    });
  }
  assert.deepEqual(sent.map(item => item.headers["idempotency-key"]), [
    "customer-lead:received:123e4567-e89b-42d3-a456-426614174000",
    "qualified-lead:123e4567-e89b-42d3-a456-426614174000",
  ]);
});
