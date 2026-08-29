import assert from "node:assert/strict";
import {
  generateKeyPairSync,
} from "node:crypto";
import {
  test,
} from "node:test";

import {
  defaultGitHubApiTimeoutMs,
  githubApiTimeoutEnvironmentVariable,
  githubAppClientIdEnvironmentVariable,
  githubAppPrivateKeyEnvironmentVariable,
  githubProviderEnvironmentVariable,
  loadGitHubConfig,
  maximumGitHubClientIdBytes,
} from "../../src/github/github-app-config.js";

const rsaPrivateKey =
  generateKeyPairSync(
    "rsa",
    {
      modulusLength: 2_048,
    },
  ).privateKey;

const encodedRsaPrivateKey =
  Buffer.from(
    rsaPrivateKey.export({
      type: "pkcs8",
      format: "pem",
    }),
  ).toString("base64");

function createAppEnvironment(
  overrides:
    NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    [githubProviderEnvironmentVariable]:
      "APP",
    [githubAppClientIdEnvironmentVariable]:
      "Iv23unit-test-client",
    [githubAppPrivateKeyEnvironmentVariable]:
      encodedRsaPrivateKey,
    ...overrides,
  };
}

test("disables GitHub collection by default without requiring credentials", () => {
  const config = loadGitHubConfig({});

  assert.deepEqual(config, {
    provider: "DISABLED",
  });
  assert.equal(
    Object.isFrozen(config),
    true,
  );
});

test("loads a bounded GitHub App configuration", () => {
  const config = loadGitHubConfig(
    createAppEnvironment(),
  );

  if (config.provider !== "APP") {
    assert.fail(
      "Expected GitHub App configuration.",
    );
  }

  assert.equal(
    config.clientId,
    "Iv23unit-test-client",
  );
  assert.equal(
    config.privateKey.type,
    "private",
  );
  assert.equal(
    config.privateKey
      .asymmetricKeyType,
    "rsa",
  );
  assert.equal(
    config.timeoutMs,
    defaultGitHubApiTimeoutMs,
  );
  assert.equal(
    Object.isFrozen(config),
    true,
  );
});

test("loads a valid GitHub API timeout override", () => {
  const config = loadGitHubConfig(
    createAppEnvironment({
      [githubApiTimeoutEnvironmentVariable]:
        "2500",
    }),
  );

  if (config.provider !== "APP") {
    assert.fail(
      "Expected GitHub App configuration.",
    );
  }

  assert.equal(config.timeoutMs, 2_500);
});

test("rejects an unsupported GitHub provider", () => {
  assert.throws(
    () => loadGitHubConfig({
      [githubProviderEnvironmentVariable]:
        "TOKEN",
    }),
    {
      message:
        "CANARYGUARD_GITHUB_PROVIDER must be DISABLED or APP.",
    },
  );
});

test("requires GitHub App credentials only when enabled", () => {
  assert.throws(
    () => loadGitHubConfig({
      [githubProviderEnvironmentVariable]:
        "APP",
    }),
    {
      message:
        "GITHUB_APP_CLIENT_ID must be configured when CANARYGUARD_GITHUB_PROVIDER=APP.",
    },
  );

  assert.throws(
    () => loadGitHubConfig({
      [githubProviderEnvironmentVariable]:
        "APP",
      [githubAppClientIdEnvironmentVariable]:
        "Iv23unit-test-client",
    }),
    {
      message:
        "GITHUB_APP_PRIVATE_KEY_BASE64 must be configured when CANARYGUARD_GITHUB_PROVIDER=APP.",
    },
  );
});

test("rejects ambiguous and oversized client identifiers", () => {
  for (const clientId of [
    "",
    " client-id",
    "client-id ",
    "client id",
    "client-id,second",
  ]) {
    assert.throws(
      () => loadGitHubConfig(
        createAppEnvironment({
          [githubAppClientIdEnvironmentVariable]:
            clientId,
        }),
      ),
      {
        message:
          "GITHUB_APP_CLIENT_ID must be a single non-whitespace token.",
      },
    );
  }

  assert.throws(
    () => loadGitHubConfig(
      createAppEnvironment({
        [githubAppClientIdEnvironmentVariable]:
          "x".repeat(
            maximumGitHubClientIdBytes
            + 1,
          ),
      }),
    ),
    {
      message:
        "GITHUB_APP_CLIENT_ID must not exceed 200 bytes.",
    },
  );
});

test("rejects invalid private keys without exposing their values", () => {
  const invalidValues = [
    "not base64!",
    Buffer.from(
      "not a private key",
    ).toString("base64"),
  ];

  for (const invalidValue of
    invalidValues) {
    let capturedError: unknown;

    try {
      loadGitHubConfig(
        createAppEnvironment({
          [githubAppPrivateKeyEnvironmentVariable]:
            invalidValue,
        }),
      );
    } catch (error) {
      capturedError = error;
    }

    assert.ok(
      capturedError instanceof Error,
    );
    assert.equal(
      capturedError.message.includes(
        invalidValue,
      ),
      false,
    );
  }
});

test("rejects a non-RSA private key", () => {
  const ecPrivateKey =
    generateKeyPairSync(
      "ec",
      {
        namedCurve: "prime256v1",
      },
    ).privateKey;

  const encodedEcPrivateKey =
    Buffer.from(
      ecPrivateKey.export({
        type: "pkcs8",
        format: "pem",
      }),
    ).toString("base64");

  assert.throws(
    () => loadGitHubConfig(
      createAppEnvironment({
        [githubAppPrivateKeyEnvironmentVariable]:
          encodedEcPrivateKey,
      }),
    ),
    {
      message:
        "GITHUB_APP_PRIVATE_KEY_BASE64 must decode to a valid RSA private key.",
    },
  );
});

test("rejects invalid GitHub API timeout values", () => {
  for (const timeout of [
    "999",
    "30001",
    "1.5",
    "invalid",
  ]) {
    assert.throws(
      () => loadGitHubConfig(
        createAppEnvironment({
          [githubApiTimeoutEnvironmentVariable]:
            timeout,
        }),
      ),
      {
        message:
          "GITHUB_API_TIMEOUT_MS must be an integer between 1000 and 30000.",
      },
    );
  }
});
