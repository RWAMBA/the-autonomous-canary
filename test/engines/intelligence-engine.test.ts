import {
  equal,
  fail,
  ok,
} from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  intelligenceTelemetrySchema,
} from "../../src/engines/intelligence/intelligence-engine.js";

const validMockTelemetry = {
  provider: "MOCK",
  modelTarget: "mock-canaryguard-v1",
  promptVersion:
    "canaryguard-review-v1",
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  latencyMs: 10,
  attempts: 1,
} as const;

const validOpenAITelemetry = {
  provider: "OPENAI",
  modelTarget: "gpt-5.6-luna",
  promptVersion:
    "canaryguard-review-v1",
  inputTokens: 1_000,
  cachedInputTokens: 200,
  cacheWriteInputTokens: 100,
  outputTokens: 200,
  reasoningTokens: 50,
  totalTokens: 1_200,
  latencyMs: 250,
  attempts: 1,
  estimatedCostUsd: 0.00042,
  pricingVersion:
    "openai-2026-08-29",
} as const;

function assertInvalidTelemetry(
  input: unknown,
  expectedPath?: string,
): void {
  const result =
    intelligenceTelemetrySchema.safeParse(
      input,
    );

  if (result.success) {
    fail(
      "Expected telemetry validation to fail.",
    );
  }

  if (expectedPath === undefined) {
    return;
  }

  ok(
    result.error.issues.some(
      (issue) =>
        issue.path.join(".")
        === expectedPath,
    ),
    JSON.stringify(
      result.error.issues,
    ),
  );
}

test(
  "preserves the existing mock telemetry contract",
  () => {
    const telemetry =
      intelligenceTelemetrySchema.parse(
        validMockTelemetry,
      );

    equal(
      telemetry.provider,
      "MOCK",
    );
    equal(
      telemetry.totalTokens,
      0,
    );
  },
);

test(
  "accepts complete OpenAI accounting telemetry",
  () => {
    const telemetry =
      intelligenceTelemetrySchema.parse(
        validOpenAITelemetry,
      );

    if (
      telemetry.provider !== "OPENAI"
    ) {
      fail(
        "Expected OpenAI telemetry.",
      );
    }

    equal(
      telemetry.cachedInputTokens,
      200,
    );
    equal(
      telemetry.cacheWriteInputTokens,
      100,
    );
    equal(
      telemetry.reasoningTokens,
      50,
    );
    equal(
      telemetry.estimatedCostUsd,
      0.00042,
    );
  },
);

test(
  "requires explicit OpenAI cost estimation telemetry",
  () => {
    const telemetry:
      Record<string, unknown> = {
        ...validOpenAITelemetry,
      };

    delete telemetry.estimatedCostUsd;

    assertInvalidTelemetry(
      telemetry,
      "estimatedCostUsd",
    );
  },
);

test(
  "rejects overlapping input token accounting",
  () => {
    assertInvalidTelemetry(
      {
        ...validOpenAITelemetry,
        cachedInputTokens: 700,
        cacheWriteInputTokens: 400,
      },
      "inputTokens",
    );
  },
);

test(
  "rejects reasoning tokens above output tokens",
  () => {
    assertInvalidTelemetry(
      {
        ...validOpenAITelemetry,
        reasoningTokens: 201,
      },
      "reasoningTokens",
    );
  },
);

test(
  "rejects inconsistent total token accounting",
  () => {
    assertInvalidTelemetry(
      {
        ...validOpenAITelemetry,
        totalTokens: 1_199,
      },
      "totalTokens",
    );
  },
);

test(
  "rejects OpenAI-only fields on mock telemetry",
  () => {
    assertInvalidTelemetry({
      ...validMockTelemetry,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningTokens: 0,
      estimatedCostUsd: 0,
      pricingVersion:
        "openai-2026-08-29",
    });
  },
);
