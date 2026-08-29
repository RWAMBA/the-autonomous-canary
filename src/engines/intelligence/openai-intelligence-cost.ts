export const openAIPricingVersion =
  "gpt-5.6-luna-2026-08-29";

export const tokensPerMillion =
  1_000_000;

export const openAIInputUsdPerMillionTokens =
  0.20;

export const openAICachedInputUsdPerMillionTokens =
  0.02;

export const openAICacheWriteUsdPerMillionTokens =
  openAIInputUsdPerMillionTokens
  * 1.25;

export const openAIOutputUsdPerMillionTokens =
  1.20;

export const openAILongContextThresholdTokens =
  272_000;

export const openAILongContextInputMultiplier =
  2;

export const openAILongContextOutputMultiplier =
  1.5;

export interface OpenAIUsageForCostEstimate {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteInputTokens: number;
  readonly outputTokens: number;
}

export interface OpenAICostEstimate {
  readonly estimatedCostUsd: number;
  readonly pricingVersion:
    typeof openAIPricingVersion;
  readonly longContextPricingApplied:
    boolean;
}

function assertTokenCount(
  name: string,
  value: number,
): void {
  if (
    !Number.isSafeInteger(value)
    || value < 0
  ) {
    throw new Error(
      `${name} must be a nonnegative safe integer.`,
    );
  }
}

function roundEstimatedUsd(
  value: number,
): number {
  return Number(
    value.toFixed(12),
  );
}

export function estimateOpenAIIntelligenceCost(
  usage: OpenAIUsageForCostEstimate,
): OpenAICostEstimate {
  assertTokenCount(
    "inputTokens",
    usage.inputTokens,
  );
  assertTokenCount(
    "cachedInputTokens",
    usage.cachedInputTokens,
  );
  assertTokenCount(
    "cacheWriteInputTokens",
    usage.cacheWriteInputTokens,
  );
  assertTokenCount(
    "outputTokens",
    usage.outputTokens,
  );

  const discountedInputTokens =
    usage.cachedInputTokens
    + usage.cacheWriteInputTokens;

  if (
    discountedInputTokens
    > usage.inputTokens
  ) {
    throw new Error(
      "Cached and cache-write tokens cannot exceed total input tokens.",
    );
  }

  const uncachedInputTokens =
    usage.inputTokens
    - discountedInputTokens;

  const longContextPricingApplied =
    usage.inputTokens
    > openAILongContextThresholdTokens;

  const inputMultiplier =
    longContextPricingApplied
      ? openAILongContextInputMultiplier
      : 1;

  const outputMultiplier =
    longContextPricingApplied
      ? openAILongContextOutputMultiplier
      : 1;

  const inputCostUsd = (
    (
      uncachedInputTokens
      * openAIInputUsdPerMillionTokens
    )
    + (
      usage.cachedInputTokens
      * openAICachedInputUsdPerMillionTokens
    )
    + (
      usage.cacheWriteInputTokens
      * openAICacheWriteUsdPerMillionTokens
    )
  )
  * inputMultiplier
  / tokensPerMillion;

  /*
   * Reasoning tokens are a breakdown of output
   * tokens and are therefore not charged again.
   */
  const outputCostUsd = (
    usage.outputTokens
    * openAIOutputUsdPerMillionTokens
    * outputMultiplier
  )
  / tokensPerMillion;

  return Object.freeze({
    estimatedCostUsd:
      roundEstimatedUsd(
        inputCostUsd
        + outputCostUsd,
      ),
    pricingVersion:
      openAIPricingVersion,
    longContextPricingApplied,
  });
}
