import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  defaultGitHubWebhookReplayCapacity,
  defaultGitHubWebhookReplayTtlMs,
  githubWebhookProviderEnvironmentVariable,
  githubWebhookReplayCapacityEnvironmentVariable,
  githubWebhookReplayTtlEnvironmentVariable,
  githubWebhookSecretEnvironmentVariable,
  loadGitHubWebhookConfig,
  maximumGitHubWebhookReplayCapacity,
  maximumGitHubWebhookSecretBytes,
  minimumGitHubWebhookReplayTtlMs,
  minimumGitHubWebhookSecretBytes,
} from "../../src/github/github-webhook-config.js";

const webhookSecret =
  "w".repeat(32);

function createEnabledEnvironment(
  overrides:
    NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    [githubWebhookProviderEnvironmentVariable]:
      "GITHUB",
    [githubWebhookSecretEnvironmentVariable]:
      webhookSecret,
    ...overrides,
  };
}

test("disables GitHub webhook ingestion by default without requiring a secret", () => {
  const config =
    loadGitHubWebhookConfig({});

  assert.deepEqual(config, {
    provider: "DISABLED",
  });
  assert.equal(
    Object.isFrozen(config),
    true,
  );
});

test("loads bounded GitHub webhook configuration", () => {
  const config =
    loadGitHubWebhookConfig(
      createEnabledEnvironment(),
    );

  if (config.provider !== "GITHUB") {
    assert.fail(
      "Expected enabled GitHub webhook configuration.",
    );
  }

  assert.equal(
    config.secret.type,
    "secret",
  );
  assert.equal(
    config.secret.symmetricKeySize,
    Buffer.byteLength(
      webhookSecret,
      "utf8",
    ),
  );
  assert.equal(
    config.replayTtlMs,
    defaultGitHubWebhookReplayTtlMs,
  );
  assert.equal(
    config.replayCapacity,
    defaultGitHubWebhookReplayCapacity,
  );
  assert.equal(
    Object.isFrozen(config),
    true,
  );
});

test("loads valid replay-protection overrides", () => {
  const config =
    loadGitHubWebhookConfig(
      createEnabledEnvironment({
        [githubWebhookReplayTtlEnvironmentVariable]:
          "120000",
        [githubWebhookReplayCapacityEnvironmentVariable]:
          "250",
      }),
    );

  if (config.provider !== "GITHUB") {
    assert.fail(
      "Expected enabled GitHub webhook configuration.",
    );
  }

  assert.equal(
    config.replayTtlMs,
    120_000,
  );
  assert.equal(
    config.replayCapacity,
    250,
  );
});

test("rejects an unsupported webhook provider", () => {
  assert.throws(
    () => loadGitHubWebhookConfig({
      [githubWebhookProviderEnvironmentVariable]:
        "APP",
    }),
    {
      message:
        "CANARYGUARD_GITHUB_WEBHOOK_PROVIDER must be DISABLED or GITHUB.",
    },
  );
});

test("requires a webhook secret only when ingestion is enabled", () => {
  assert.throws(
    () => loadGitHubWebhookConfig({
      [githubWebhookProviderEnvironmentVariable]:
        "GITHUB",
    }),
    {
      message:
        "GITHUB_WEBHOOK_SECRET must be configured when CANARYGUARD_GITHUB_WEBHOOK_PROVIDER=GITHUB.",
    },
  );
});

test("rejects ambiguous and unbounded webhook secrets without exposing them", () => {
  const invalidSecrets = [
    "",
    " short",
    "short ",
    "contains whitespace".repeat(2),
    "contains,comma".repeat(3),
    "x".repeat(
      minimumGitHubWebhookSecretBytes - 1,
    ),
    "x".repeat(
      maximumGitHubWebhookSecretBytes + 1,
    ),
  ];

  for (const secret of invalidSecrets) {
    assert.throws(
      () => loadGitHubWebhookConfig(
        createEnabledEnvironment({
          [githubWebhookSecretEnvironmentVariable]:
            secret,
        }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        if (secret.length > 0) {
          assert.equal(
            error.message.includes(secret),
            false,
          );
        }

        return true;
      },
    );
  }
});

test("rejects invalid replay-protection bounds", () => {
  const invalidOverrides = [
    {
      [githubWebhookReplayTtlEnvironmentVariable]:
        String(
          minimumGitHubWebhookReplayTtlMs
          - 1,
        ),
    },
    {
      [githubWebhookReplayTtlEnvironmentVariable]:
        "not-a-number",
    },
    {
      [githubWebhookReplayCapacityEnvironmentVariable]:
        String(
          maximumGitHubWebhookReplayCapacity
          + 1,
        ),
    },
    {
      [githubWebhookReplayCapacityEnvironmentVariable]:
        "100.5",
    },
  ];

  for (const override of invalidOverrides) {
    assert.throws(
      () => loadGitHubWebhookConfig(
        createEnabledEnvironment(
          override,
        ),
      ),
    );
  }
});
