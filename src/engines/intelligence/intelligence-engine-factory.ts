import type {
  IntelligenceEngine,
} from "./intelligence-engine.js";
import {
  MockIntelligenceEngine,
} from "./mock-intelligence-engine.js";
import type {
  IntelligenceConfig,
} from "./openai-intelligence-config.js";
import {
  OpenAIIntelligenceEngine,
} from "./openai-intelligence-engine.js";

export function createIntelligenceEngine(
  config: IntelligenceConfig,
): IntelligenceEngine {
  switch (config.provider) {
    case "MOCK":
      return new MockIntelligenceEngine();

    case "OPENAI":
      return new OpenAIIntelligenceEngine({
        config,
      });

    default: {
      const unsupportedConfig:
        never = config;

      void unsupportedConfig;

      throw new Error(
        "Unsupported intelligence provider configuration.",
      );
    }
  }
}
