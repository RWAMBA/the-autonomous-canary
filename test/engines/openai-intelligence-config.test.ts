import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  defaultOpenAIMaxOutputTokens,
  defaultOpenAIMaxRetries,
  defaultOpenAITimeoutMs,
  intelligenceProviderEnvironmentVariable,
  loadIntelligenceConfig,
  maximumOpenAIApiKeyBytes,
  openAIApiKeyEnvironmentVariable,
  openAIIntelligenceModelTarget,
  openAIMaxOutputTokensEnvironmentVariable,
  openAIMaxRetriesEnvironmentVariable,
  openAITimeoutEnvironmentVariable,
} from "../../src/engines/intelligence/openai-intelligence-config.js";

const fakeApiKey =
  "unit-test-openai-value";

function createOpenAIEnvironment(
  overrides:
    NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    [intelligenceProviderEnvironmentVariable]:
      "OPENAI",
    [openAIApiKeyEnvironmentVariable]:
      fakeApiKey,
    ...overrides,
  };
}

function assertConfigurationError(
  environment: NodeJS.ProcessEnv,
  expectedMessage: string,
): void {
  assert.throws(
    () =>
      loadIntelligenceConfig(
        environment,
      ),
    {
      message: expectedMessage,
    },
  );
}

test(
  "uses the mock provider by default without requiring an API key",
  () => {
    const config =
      loadIntelligenceConfig({});

    assert.deepEqual(
      config,
      {
        provider: "MOCK",
      },
    );

    assert.equal(
      Object.isFrozen(config),
      true,
    );
  },
);

test(
  "loads OpenAI configuration with bounded defaults",
  () => {
    const config =
      loadIntelligenceConfig(
        createOpenAIEnvironment(),
      );

    if (config.provider !== "OPENAI") {
      assert.fail(
        "Expected OpenAI configuration.",
      );
    }

    assert.equal(
      config.apiKey,
      fakeApiKey,
    );
    assert.equal(
      config.model,
      openAIIntelligenceModelTarget,
    );
    assert.equal(
      config.timeoutMs,
      defaultOpenAITimeoutMs,
    );
    assert.equal(
      config.maxRetries,
      defaultOpenAIMaxRetries,
    );
    assert.equal(
      config.maxOutputTokens,
      defaultOpenAIMaxOutputTokens,
    );
    assert.equal(
      Object.isFrozen(config),
      true,
    );
  },
);

test(
  "loads valid numeric OpenAI overrides",
  () => {
    const config =
      loadIntelligenceConfig(
        createOpenAIEnvironment({
          [openAITimeoutEnvironmentVariable]:
            "2500",
          [openAIMaxRetriesEnvironmentVariable]:
            "1",
          [openAIMaxOutputTokensEnvironmentVariable]:
            "512",
        }),
      );

    if (config.provider !== "OPENAI") {
      assert.fail(
        "Expected OpenAI configuration.",
      );
    }

    assert.equal(
      config.timeoutMs,
      2_500,
    );
    assert.equal(
      config.maxRetries,
      1,
    );
    assert.equal(
      config.maxOutputTokens,
      512,
    );
  },
);

test(
  "keeps the reviewed model target fixed",
  () => {
    const config =
      loadIntelligenceConfig(
        createOpenAIEnvironment({
          OPENAI_MODEL:
            "unreviewed-model",
        }),
      );

    if (config.provider !== "OPENAI") {
      assert.fail(
        "Expected OpenAI configuration.",
      );
    }

    assert.equal(
      config.model,
      "gpt-5.6-luna",
    );
  },
);

test(
  "rejects an unsupported intelligence provider",
  () => {
    assertConfigurationError(
      {
        [intelligenceProviderEnvironmentVariable]:
          "UNKNOWN",
      },
      "CANARYGUARD_INTELLIGENCE_PROVIDER must be MOCK or OPENAI.",
    );
  },
);

test(
  "requires the API key only for the OpenAI provider",
  () => {
    assertConfigurationError(
      {
        [intelligenceProviderEnvironmentVariable]:
          "OPENAI",
      },
      "OPENAI_API_KEY must be configured when CANARYGUARD_INTELLIGENCE_PROVIDER=OPENAI.",
    );
  },
);

test(
  "rejects ambiguous OpenAI API-key values",
  () => {
    const invalidApiKeys = [
      "",
      ` ${fakeApiKey}`,
      `${fakeApiKey} `,
      `unit test value`,
      `${fakeApiKey},second-value`,
    ];

    for (
      const apiKey
      of invalidApiKeys
    ) {
      assertConfigurationError(
        createOpenAIEnvironment({
          [openAIApiKeyEnvironmentVariable]:
            apiKey,
        }),
        "OPENAI_API_KEY must be a single non-whitespace token.",
      );
    }
  },
);

test(
  "rejects an oversized API key without exposing it",
  () => {
    const oversizedApiKey =
      "x".repeat(
        maximumOpenAIApiKeyBytes
        + 1,
      );

    let capturedError: unknown;

    try {
      loadIntelligenceConfig(
        createOpenAIEnvironment({
          [openAIApiKeyEnvironmentVariable]:
            oversizedApiKey,
        }),
      );
    } catch (error) {
      capturedError = error;
    }

    assert.ok(
      capturedError instanceof Error,
    );

    assert.equal(
      capturedError.message,
      "OPENAI_API_KEY must not exceed 512 bytes.",
    );

    assert.equal(
      capturedError.message.includes(
        oversizedApiKey,
      ),
      false,
    );
  },
);

test(
  "rejects invalid OpenAI timeout values",
  () => {
    for (
      const value
      of [
        "",
        "-1",
        "999",
        "1.5",
        "60001",
      ]
    ) {
      assertConfigurationError(
        createOpenAIEnvironment({
          [openAITimeoutEnvironmentVariable]:
            value,
        }),
        "OPENAI_TIMEOUT_MS must be an integer between 1000 and 60000.",
      );
    }
  },
);

test(
  "rejects invalid OpenAI retry values",
  () => {
    for (
      const value
      of [
        "",
        "-1",
        "1.5",
        "4",
      ]
    ) {
      assertConfigurationError(
        createOpenAIEnvironment({
          [openAIMaxRetriesEnvironmentVariable]:
            value,
        }),
        "OPENAI_MAX_RETRIES must be an integer between 0 and 3.",
      );
    }
  },
);

test(
  "rejects invalid OpenAI output-token limits",
  () => {
    for (
      const value
      of [
        "",
        "-1",
        "1.5",
        "255",
        "16001",
      ]
    ) {
      assertConfigurationError(
        createOpenAIEnvironment({
          [openAIMaxOutputTokensEnvironmentVariable]:
            value,
        }),
        "OPENAI_MAX_OUTPUT_TOKENS must be an integer between 256 and 16000.",
      );
    }
  },
);
