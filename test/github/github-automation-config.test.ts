import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  defaultGitHubAutomationConcurrency,
  defaultGitHubAutomationQueueCapacity,
  githubAutomationConcurrencyEnvironmentVariable,
  githubAutomationProviderEnvironmentVariable,
  githubAutomationQueueCapacityEnvironmentVariable,
  loadGitHubAutomationConfig,
} from "../../src/github/github-automation-config.js";

test("keeps GitHub Check Run automation disabled by default", () => {
  assert.deepEqual(
    loadGitHubAutomationConfig({}),
    {
      provider: "DISABLED",
    },
  );
});

test("loads bounded Check Run automation defaults", () => {
  assert.deepEqual(
    loadGitHubAutomationConfig({
      [githubAutomationProviderEnvironmentVariable]:
        "CHECKS",
    }),
    {
      provider: "CHECKS",
      queueCapacity:
        defaultGitHubAutomationQueueCapacity,
      concurrency:
        defaultGitHubAutomationConcurrency,
    },
  );
});

test("loads valid Check Run queue overrides", () => {
  assert.deepEqual(
    loadGitHubAutomationConfig({
      [githubAutomationProviderEnvironmentVariable]:
        "CHECKS",
      [githubAutomationQueueCapacityEnvironmentVariable]:
        "25",
      [githubAutomationConcurrencyEnvironmentVariable]:
        "3",
    }),
    {
      provider: "CHECKS",
      queueCapacity: 25,
      concurrency: 3,
    },
  );
});

test("rejects unsupported providers and unsafe queue controls", () => {
  assert.throws(
    () => loadGitHubAutomationConfig({
      [githubAutomationProviderEnvironmentVariable]:
        "ENABLED",
    }),
  );

  for (const [variableName, value] of [
    [
      githubAutomationQueueCapacityEnvironmentVariable,
      "0",
    ],
    [
      githubAutomationQueueCapacityEnvironmentVariable,
      "1001",
    ],
    [
      githubAutomationConcurrencyEnvironmentVariable,
      "0",
    ],
    [
      githubAutomationConcurrencyEnvironmentVariable,
      "11",
    ],
    [
      githubAutomationConcurrencyEnvironmentVariable,
      "1.5",
    ],
  ] as const) {
    assert.throws(
      () => loadGitHubAutomationConfig({
        [githubAutomationProviderEnvironmentVariable]:
          "CHECKS",
        [variableName]: value,
      }),
    );
  }
});
