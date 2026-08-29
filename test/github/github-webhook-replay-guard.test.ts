import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  InMemoryGitHubWebhookReplayGuard,
} from "../../src/github/github-webhook-replay-guard.js";

test("reserves a unique delivery and rejects its replay", () => {
  const guard =
    new InMemoryGitHubWebhookReplayGuard({
      ttlMs: 60_000,
      capacity: 10,
      clock: () => 1_000,
    });

  assert.equal(
    guard.reserve("delivery-1"),
    "ACCEPTED",
  );
  assert.equal(
    guard.reserve("delivery-1"),
    "DUPLICATE",
  );
});

test("permits a delivery identifier after its replay window expires", () => {
  let currentTime = 1_000;

  const guard =
    new InMemoryGitHubWebhookReplayGuard({
      ttlMs: 100,
      capacity: 1,
      clock: () => currentTime,
    });

  assert.equal(
    guard.reserve("delivery-1"),
    "ACCEPTED",
  );

  currentTime = 1_099;

  assert.equal(
    guard.reserve("delivery-2"),
    "CAPACITY_EXCEEDED",
  );

  currentTime = 1_100;

  assert.equal(
    guard.reserve("delivery-2"),
    "ACCEPTED",
  );
});

test("does not evict an active delivery when capacity is reached", () => {
  const guard =
    new InMemoryGitHubWebhookReplayGuard({
      ttlMs: 60_000,
      capacity: 1,
      clock: () => 1_000,
    });

  assert.equal(
    guard.reserve("delivery-1"),
    "ACCEPTED",
  );
  assert.equal(
    guard.reserve("delivery-2"),
    "CAPACITY_EXCEEDED",
  );
  assert.equal(
    guard.reserve("delivery-1"),
    "DUPLICATE",
  );
});

test("rejects invalid replay-guard construction values", () => {
  assert.throws(
    () => new InMemoryGitHubWebhookReplayGuard({
      ttlMs: 0,
      capacity: 1,
    }),
    {
      name: "RangeError",
    },
  );

  assert.throws(
    () => new InMemoryGitHubWebhookReplayGuard({
      ttlMs: 1,
      capacity: 0,
    }),
    {
      name: "RangeError",
    },
  );
});

test("rejects an invalid replay clock", () => {
  const guard =
    new InMemoryGitHubWebhookReplayGuard({
      ttlMs: 1,
      capacity: 1,
      clock: () => Number.NaN,
    });

  assert.throws(
    () => guard.reserve("delivery-1"),
    {
      message:
        "GitHub webhook replay clock returned an invalid time.",
    },
  );
});
