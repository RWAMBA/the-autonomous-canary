import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  loadDurableAutomationConfig,
} from "../../src/persistence/durable-automation-config.js";

test("loads bounded durable automation defaults", () => {
  assert.deepEqual(
    loadDurableAutomationConfig({}),
    {
      pollIntervalMs: 1_000,
      leaseMs: 60_000,
      maximumAttempts: 3,
      retryBaseMs: 5_000,
    },
  );
});

test("rejects unsafe durable automation controls", () => {
  for (const environment of [
    {
      GITHUB_AUTOMATION_POLL_INTERVAL_MS:
        "99",
    },
    {
      GITHUB_AUTOMATION_LEASE_MS:
        "9999",
    },
    {
      GITHUB_AUTOMATION_MAX_ATTEMPTS:
        "11",
    },
    {
      GITHUB_AUTOMATION_RETRY_BASE_MS:
        "not-an-integer",
    },
  ]) {
    assert.throws(
      () => loadDurableAutomationConfig(
        environment,
      ),
    );
  }
});
