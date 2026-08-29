import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  estimateOpenAIIntelligenceCost,
  openAICachedInputUsdPerMillionTokens,
  openAICacheWriteUsdPerMillionTokens,
  openAIInputUsdPerMillionTokens,
  openAILongContextThresholdTokens,
  openAIOutputUsdPerMillionTokens,
  openAIPricingVersion,
} from "../../src/engines/intelligence/openai-intelligence-cost.js";

test(
  "exposes the versioned GPT-5.6 Luna pricing assumptions",
  () => {
    assert.equal(
      openAIPricingVersion,
      "gpt-5.6-luna-2026-08-29",
    );
    assert.equal(
      openAIInputUsdPerMillionTokens,
      0.20,
    );
    assert.equal(
      openAICachedInputUsdPerMillionTokens,
      0.02,
    );
    assert.equal(
      openAICacheWriteUsdPerMillionTokens,
      0.25,
    );
    assert.equal(
      openAIOutputUsdPerMillionTokens,
      1.20,
    );
    assert.equal(
      openAILongContextThresholdTokens,
      272_000,
    );
  },
);

test(
  "estimates zero cost for zero usage",
  () => {
    const estimate =
      estimateOpenAIIntelligenceCost({
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
      });

    assert.deepEqual(
      estimate,
      {
        estimatedCostUsd: 0,
        pricingVersion:
          openAIPricingVersion,
        longContextPricingApplied:
          false,
      },
    );

    assert.equal(
      Object.isFrozen(estimate),
      true,
    );
  },
);

test(
  "estimates standard-context mixed token costs",
  () => {
    const estimate =
      estimateOpenAIIntelligenceCost({
        inputTokens: 270_000,
        cachedInputTokens: 90_000,
        cacheWriteInputTokens:
          90_000,
        outputTokens: 100_000,
      });

    /*
     * 90K uncached input: $0.018
     * 90K cached input:   $0.0018
     * 90K cache write:    $0.0225
     * 100K output:        $0.12
     */
    assert.equal(
      estimate.estimatedCostUsd,
      0.1623,
    );

    assert.equal(
      estimate
        .longContextPricingApplied,
      false,
    );
  },
);

test(
  "does not apply long-context pricing at the threshold",
  () => {
    const estimate =
      estimateOpenAIIntelligenceCost({
        inputTokens: 272_000,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 100_000,
      });

    assert.equal(
      estimate.estimatedCostUsd,
      0.1744,
    );

    assert.equal(
      estimate
        .longContextPricingApplied,
      false,
    );
  },
);

test(
  "applies full-request long-context multipliers above the threshold",
  () => {
    const estimate =
      estimateOpenAIIntelligenceCost({
        inputTokens: 272_001,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 100_000,
      });

    assert.equal(
      estimate.estimatedCostUsd,
      0.2888004,
    );

    assert.equal(
      estimate
        .longContextPricingApplied,
      true,
    );
  },
);

test(
  "rejects invalid token counters",
  () => {
    const validUsage = {
      inputTokens: 100,
      cachedInputTokens: 20,
      cacheWriteInputTokens: 10,
      outputTokens: 50,
    };

    const fieldNames = [
      "inputTokens",
      "cachedInputTokens",
      "cacheWriteInputTokens",
      "outputTokens",
    ] as const;

    const invalidValues = [
      -1,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
    ];

    for (
      const fieldName
      of fieldNames
    ) {
      for (
        const invalidValue
        of invalidValues
      ) {
        assert.throws(
          () =>
            estimateOpenAIIntelligenceCost({
              ...validUsage,
              [fieldName]:
                invalidValue,
            }),
          {
            message:
              `${fieldName} must be a nonnegative safe integer.`,
          },
        );
      }
    }
  },
);

test(
  "rejects overlapping input categories",
  () => {
    assert.throws(
      () =>
        estimateOpenAIIntelligenceCost({
          inputTokens: 100,
          cachedInputTokens: 60,
          cacheWriteInputTokens: 41,
          outputTokens: 0,
        }),
      {
        message:
          "Cached and cache-write tokens cannot exceed total input tokens.",
      },
    );
  },
);
