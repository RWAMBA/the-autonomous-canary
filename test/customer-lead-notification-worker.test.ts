import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CustomerLeadNotificationWorker,
} from "../src/customer-lead-notification-worker.js";
import type {
  ClaimedCustomerLeadNotification,
  CustomerLeadNotificationOutbox,
} from "../src/persistence/customer-lead-store.js";

const notification: ClaimedCustomerLeadNotification = {
  notificationId:
    "customer-lead:received:123e4567-e89b-42d3-a456-426614174000",
  event: "RECEIVED",
  leadId: "123e4567-e89b-42d3-a456-426614174000",
  occurredAt: "2026-09-16T16:00:00.000Z",
  attempts: 1,
};

const config = {
  pollIntervalMs: 5_000,
  leaseMs: 30_000,
  retryBaseMs: 60_000,
  retryMaxMs: 3_600_000,
};

test("delivers one claimed notification and marks the outbox row complete", async () => {
  let claimCalls = 0;
  let delivered: unknown;
  let completed: unknown;
  const outbox = {
    claimNotification: (now, leaseExpiresAt) => {
      claimCalls += 1;
      assert.equal(now, "2026-09-16T16:01:00.000Z");
      assert.equal(leaseExpiresAt, "2026-09-16T16:01:30.000Z");
      return Promise.resolve(notification);
    },
    completeNotification: (notificationId, deliveredAt) => {
      completed = { notificationId, deliveredAt };
      return Promise.resolve();
    },
    retryNotification: () => Promise.reject(new Error("must not retry")),
  } satisfies CustomerLeadNotificationOutbox;
  const worker = new CustomerLeadNotificationWorker(
    outbox,
    {
      notify: (value) => {
        delivered = value;
        return Promise.resolve();
      },
    },
    config,
    { clock: () => new Date("2026-09-16T16:01:00.000Z") },
  );

  assert.equal(await worker.runOnce(), true);
  assert.equal(claimCalls, 1);
  assert.deepEqual(delivered, {
    event: "RECEIVED",
    leadId: notification.leadId,
    occurredAt: notification.occurredAt,
  });
  assert.deepEqual(completed, {
    notificationId: notification.notificationId,
    deliveredAt: "2026-09-16T16:01:00.000Z",
  });
});

test("reschedules a failed notification without logging relay details", async () => {
  let retried: unknown;
  const logs: Array<Readonly<Record<string, unknown>>> = [];
  const outbox = {
    claimNotification: () => Promise.resolve({
      ...notification,
      attempts: 3,
    }),
    completeNotification: () => Promise.reject(new Error("must not complete")),
    retryNotification: (notificationId, nextAttemptAt) => {
      retried = { notificationId, nextAttemptAt };
      return Promise.resolve();
    },
  } satisfies CustomerLeadNotificationOutbox;
  const worker = new CustomerLeadNotificationWorker(
    outbox,
    {
      notify: () => Promise.reject(
        new Error("provider response contains sensitive internals"),
      ),
    },
    config,
    {
      clock: () => new Date("2026-09-16T16:01:00.000Z"),
      logger: (entry) => logs.push(entry),
    },
  );

  assert.equal(await worker.runOnce(), true);
  assert.deepEqual(retried, {
    notificationId: notification.notificationId,
    nextAttemptAt: "2026-09-16T16:05:00.000Z",
  });
  assert.equal(logs.length, 1);
  assert.equal(
    JSON.stringify(logs).includes("sensitive internals"),
    false,
  );
});
