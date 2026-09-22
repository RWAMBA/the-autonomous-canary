import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./worker.mjs";

const leadId = "123e4567-e89b-42d3-a456-426614174000";
const key = `customer-lead:received:${leadId}`;
const message = {
  recipient: "operator@example.com",
  subject: "New CanaryGuard customer request",
  text: `Customer request ${leadId} was received at 2026-09-22T16:00:00.000Z. Open the protected CanaryGuard management dashboard to review it.`,
};
const env = {
  RELAY_API_KEY: "r".repeat(48),
  RESEND_API_KEY: "re_test_key",
  NOTIFICATION_RECIPIENT: "operator@example.com",
  MAIL_FROM: "CanaryGuard <alerts@example.com>",
};

function request(body = message, headers = {}) {
  return new Request("https://relay.example.com/notify", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RELAY_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": key,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("forwards the app notification once with the same idempotency key", async () => {
  const calls = [];
  const send = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
  };
  const result = await worker.fetch(request(), env, { fetchImplementation: send });
  assert.equal(result.status, 202);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal(calls[0].init.headers["idempotency-key"], key);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${env.RESEND_API_KEY}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    from: env.MAIL_FROM,
    to: [env.NOTIFICATION_RECIPIENT],
    subject: message.subject,
    text: message.text,
  });
});

test("rejects unauthenticated requests and unauthorized recipients without sending", async () => {
  const send = () => { throw new Error("must not send"); };
  assert.equal((await worker.fetch(request(message, { authorization: "Bearer wrong" }), env, { fetchImplementation: send })).status, 401);
  assert.equal((await worker.fetch(request({ ...message, recipient: "elsewhere@example.com" }), env, { fetchImplementation: send })).status, 400);
});

test("rejects a mismatched event key and does not accept arbitrary email content", async () => {
  const send = () => { throw new Error("must not send"); };
  assert.equal((await worker.fetch(request(message, { "idempotency-key": `qualified-lead:${leadId}` }), env, { fetchImplementation: send })).status, 400);
  assert.equal((await worker.fetch(request({ ...message, subject: "Arbitrary email" }), env, { fetchImplementation: send })).status, 400);
});

test("returns a retryable error when the provider rejects or cannot be reached", async () => {
  assert.equal((await worker.fetch(request(), env, { fetchImplementation: async () => new Response("secret error", { status: 429 }) })).status, 502);
  assert.equal((await worker.fetch(request(), env, { fetchImplementation: async () => { throw new Error("secret error"); } })).status, 502);
});
