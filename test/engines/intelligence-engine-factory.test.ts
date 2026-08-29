import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  createIntelligenceEngine,
} from "../../src/engines/intelligence/intelligence-engine-factory.js";
import {
  MockIntelligenceEngine,
} from "../../src/engines/intelligence/mock-intelligence-engine.js";
import {
  openAIIntelligenceModelTarget,
} from "../../src/engines/intelligence/openai-intelligence-config.js";
import {
  OpenAIIntelligenceEngine,
} from "../../src/engines/intelligence/openai-intelligence-engine.js";

test(
  "creates the mock intelligence engine from mock configuration",
  () => {
    const engine =
      createIntelligenceEngine({
        provider: "MOCK",
      });

    assert.ok(
      engine
      instanceof MockIntelligenceEngine,
    );
  },
);

test(
  "creates the OpenAI intelligence engine from validated configuration",
  () => {
    const configuration =
      Object.freeze({
        provider: "OPENAI" as const,
        apiKey:
          "unit-test-openai-api-key-value",
        model:
          openAIIntelligenceModelTarget,
        timeoutMs: 15_000,
        maxRetries: 2,
        maxOutputTokens: 4_000,
      });

    const engine =
      createIntelligenceEngine(
        configuration,
      );

    assert.ok(
      engine
      instanceof OpenAIIntelligenceEngine,
    );

    assert.deepEqual(
      configuration,
      {
        provider: "OPENAI",
        apiKey:
          "unit-test-openai-api-key-value",
        model:
          openAIIntelligenceModelTarget,
        timeoutMs: 15_000,
        maxRetries: 2,
        maxOutputTokens: 4_000,
      },
    );
  },
);
