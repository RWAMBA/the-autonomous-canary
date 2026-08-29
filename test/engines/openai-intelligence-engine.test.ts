import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
} from "openai";

import {
  parseReviewRequest,
} from "../../src/dto/review-request.js";
import type {
  IntelligenceAssessment,
} from "../../src/engines/intelligence/intelligence-engine.js";
import {
  openAIIntelligenceModelTarget,
} from "../../src/engines/intelligence/openai-intelligence-config.js";
import type {
  OpenAIIntelligenceConfig,
} from "../../src/engines/intelligence/openai-intelligence-config.js";
import {
  openAIPricingVersion,
} from "../../src/engines/intelligence/openai-intelligence-cost.js";
import {
  OpenAIIntelligenceEngine,
  OpenAIIntelligenceError,
  openAIIntelligenceResponseSchemaName,
} from "../../src/engines/intelligence/openai-intelligence-engine.js";
import type {
  OpenAIIntelligenceErrorCode,
} from "../../src/engines/intelligence/openai-intelligence-engine.js";
import {
  canaryGuardPromptVersion,
  reviewSystemInstructions,
} from "../../src/engines/intelligence/review-prompt.js";

interface FakeUsage {
  readonly input_tokens: number;
  readonly input_tokens_details: {
    readonly cached_tokens: number;
    readonly cache_write_tokens: number;
  };
  readonly output_tokens: number;
  readonly output_tokens_details: {
    readonly reasoning_tokens: number;
  };
  readonly total_tokens: number;
}

interface FakeOutputContent {
  readonly type: string;
  readonly refusal?: string;
  readonly text?: string;
}

interface FakeOutputItem {
  readonly type: string;
  readonly content?: readonly FakeOutputContent[];
}

interface FakeParsedResponse {
  readonly status: string;
  readonly incomplete_details:
    | {
      readonly reason: string;
    }
    | null;
  readonly output:
    readonly FakeOutputItem[];
  readonly output_parsed: unknown;
  readonly usage:
    FakeUsage | null | undefined;
}

type FakeParse = (
  body: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<FakeParsedResponse>;

const defaultAssessment:
  IntelligenceAssessment = {
    advisoryDecision: "CONTINUE",
    riskScore: 24,
    riskLevel: "LOW",
    summary:
      "The structured assessment found low release risk.",
    findings: [],
    requiredActions: [],
    advisoryDeployment: {
      strategy: "STANDARD",
      initialTrafficPercent: 100,
    },
  };

const defaultUsage: FakeUsage = {
  input_tokens: 1_000,
  input_tokens_details: {
    cached_tokens: 200,
    cache_write_tokens: 100,
  },
  output_tokens: 300,
  output_tokens_details: {
    reasoning_tokens: 100,
  },
  total_tokens: 1_300,
};

const defaultConfig:
  OpenAIIntelligenceConfig = {
    provider: "OPENAI",
    apiKey:
      "unit-test-openai-api-key-value",
    model:
      openAIIntelligenceModelTarget,
    timeoutMs: 15_000,
    maxRetries: 2,
    maxOutputTokens: 4_000,
  };

function createRequest() {
  return parseReviewRequest({
    repository: {
      owner: "RWAMBA",
      name: "the-autonomous-canary",
    },
    change: {
      title:
        "Review a candidate release",
      description:
        "Validated and sanitized release data.",
      baseSha: "abcdef1234567890",
      headSha: "1234567890abcdef",
      diff:
        "+export const reviewEnabled = true;",
    },
    evidence: {
      testStatus: "passed",
      securityFindings: [],
    },
  });
}

function createResponse(
  overrides:
    Partial<FakeParsedResponse> = {},
): FakeParsedResponse {
  return {
    status: "completed",
    incomplete_details: null,
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(
              defaultAssessment,
            ),
          },
        ],
      },
    ],
    output_parsed:
      defaultAssessment,
    usage: defaultUsage,
    ...overrides,
  };
}

function createClient(
  parse: FakeParse,
): OpenAI {
  return {
    responses: {
      parse,
    },
  } as unknown as OpenAI;
}

function createConfig(
  overrides:
    Partial<OpenAIIntelligenceConfig> = {},
): OpenAIIntelligenceConfig {
  return {
    ...defaultConfig,
    ...overrides,
  };
}

async function assertEngineError(
  promise: Promise<unknown>,
  expectedCode:
    OpenAIIntelligenceErrorCode,
  forbiddenText?: string,
): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => {
      assert.ok(
        error
        instanceof OpenAIIntelligenceError,
      );
      assert.equal(
        error.code,
        expectedCode,
      );

      if (forbiddenText !== undefined) {
        assert.equal(
          error.message.includes(
            forbiddenText,
          ),
          false,
        );
      }

      return true;
    },
  );
}

test(
  "sends a transient structured request and records complete usage telemetry",
  async () => {
    let capturedBody:
      Record<string, unknown>
      | undefined;
    let capturedOptions:
      Record<string, unknown>
      | undefined;

    const client = createClient(
      async (body, options) => {
        capturedBody = body;
        capturedOptions = options;
        return createResponse();
      },
    );

    const clockValues = [
      100,
      145,
    ];

    const engine =
      new OpenAIIntelligenceEngine({
        config: defaultConfig,
        client,
        now: () =>
          clockValues.shift() ?? 145,
      });

    const result = await engine.analyze(
      createRequest(),
    );

    assert.ok(capturedBody);
    assert.ok(capturedOptions);

    assert.deepEqual(
      Object.keys(capturedBody).sort(),
      [
        "input",
        "instructions",
        "max_output_tokens",
        "model",
        "store",
        "text",
      ],
    );

    assert.equal(
      capturedBody.model,
      openAIIntelligenceModelTarget,
    );
    assert.equal(
      capturedBody.instructions,
      reviewSystemInstructions,
    );
    assert.equal(
      capturedBody.store,
      false,
    );
    assert.equal(
      capturedBody.max_output_tokens,
      defaultConfig.maxOutputTokens,
    );
    assert.equal(
      capturedOptions.timeout,
      defaultConfig.timeoutMs,
    );

    assert.equal(
      typeof capturedBody.input,
      "string",
    );
    assert.equal(
      String(capturedBody.input)
        .includes(defaultConfig.apiKey),
      false,
    );

    assert.equal(
      typeof capturedBody.text,
      "object",
    );
    assert.equal(
      JSON.stringify(capturedBody.text)
        .includes(
          openAIIntelligenceResponseSchemaName,
        ),
      true,
    );

    assert.deepEqual(
      result.assessment,
      defaultAssessment,
    );
    assert.deepEqual(
      result.telemetry,
      {
        provider: "OPENAI",
        modelTarget:
          openAIIntelligenceModelTarget,
        promptVersion:
          canaryGuardPromptVersion,
        inputTokens: 1_000,
        cachedInputTokens: 200,
        cacheWriteInputTokens: 100,
        outputTokens: 300,
        reasoningTokens: 100,
        totalTokens: 1_300,
        latencyMs: 45,
        attempts: 1,
        estimatedCostUsd:
          0.000529,
        pricingVersion:
          openAIPricingVersion,
      },
    );
  },
);

test(
  "rejects a model refusal without exposing refusal content",
  async () => {
    const privateRefusal =
      "private provider refusal content";

    const client = createClient(
      async () =>
        createResponse({
          output: [
            {
              type: "message",
              content: [
                {
                  type: "refusal",
                  refusal:
                    privateRefusal,
                },
              ],
            },
          ],
          output_parsed: null,
        }),
    );

    const engine =
      new OpenAIIntelligenceEngine({
        config: defaultConfig,
        client,
      });

    await assertEngineError(
      engine.analyze(createRequest()),
      "OPENAI_REFUSAL",
      privateRefusal,
    );
  },
);

test(
  "rejects an incomplete response without retrying",
  async () => {
    let attempts = 0;
    const delays: number[] = [];

    const client = createClient(
      async () => {
        attempts += 1;
        return createResponse({
          status: "incomplete",
          incomplete_details: {
            reason:
              "max_output_tokens",
          },
          output_parsed: null,
        });
      },
    );

    const engine =
      new OpenAIIntelligenceEngine({
        config: defaultConfig,
        client,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      });

    await assertEngineError(
      engine.analyze(createRequest()),
      "OPENAI_INCOMPLETE_RESPONSE",
    );

    assert.equal(attempts, 1);
    assert.deepEqual(delays, []);
  },
);

test(
  "rejects a completed response without usage accounting",
  async () => {
    const client = createClient(
      async () =>
        createResponse({
          usage: undefined,
        }),
    );

    const engine =
      new OpenAIIntelligenceEngine({
        config: defaultConfig,
        client,
      });

    await assertEngineError(
      engine.analyze(createRequest()),
      "OPENAI_INVALID_RESPONSE",
    );
  },
);

test(
  "rejects invalid parsed structured output",
  async () => {
    const client = createClient(
      async () =>
        createResponse({
          output_parsed: {
            ...defaultAssessment,
            riskScore: 101,
          },
        }),
    );

    const engine =
      new OpenAIIntelligenceEngine({
        config: defaultConfig,
        client,
      });

    await assertEngineError(
      engine.analyze(createRequest()),
      "OPENAI_INVALID_RESPONSE",
    );
  },
);

test(
  "retries a transient connection failure and records the successful attempt",
  async () => {
    let attempts = 0;
    const delays: number[] = [];

    const client = createClient(
      async () => {
        attempts += 1;

        if (attempts === 1) {
          throw new APIConnectionError({
            message:
              "temporary connection failure",
          });
        }

        return createResponse();
      },
    );

    const clockValues = [
      10,
      50,
    ];

    const engine =
      new OpenAIIntelligenceEngine({
        config: defaultConfig,
        client,
        now: () =>
          clockValues.shift() ?? 50,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      });

    const result = await engine.analyze(
      createRequest(),
    );

    assert.equal(attempts, 2);
    assert.deepEqual(delays, [
      250,
    ]);
    assert.equal(
      result.telemetry.attempts,
      2,
    );
    assert.equal(
      result.telemetry.latencyMs,
      40,
    );
  },
);

test(
  "returns a sanitized timeout after exhausting bounded retries",
  async () => {
    let attempts = 0;
    const delays: number[] = [];
    const privateProviderText =
      "private timeout provider detail";

    const client = createClient(
      async () => {
        attempts += 1;
        throw new APIConnectionTimeoutError({
          message: privateProviderText,
        });
      },
    );

    const engine =
      new OpenAIIntelligenceEngine({
        config: defaultConfig,
        client,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      });

    await assertEngineError(
      engine.analyze(createRequest()),
      "OPENAI_TIMEOUT",
      privateProviderText,
    );

    assert.equal(attempts, 3);
    assert.deepEqual(delays, [
      250,
      500,
    ]);
  },
);

test(
  "returns provider unavailable after exhausting transient connection retries",
  async () => {
    let attempts = 0;
    const delays: number[] = [];

    const client = createClient(
      async () => {
        attempts += 1;
        throw new APIConnectionError({
          message:
            "temporary provider failure",
        });
      },
    );

    const engine =
      new OpenAIIntelligenceEngine({
        config: defaultConfig,
        client,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      });

    await assertEngineError(
      engine.analyze(createRequest()),
      "OPENAI_PROVIDER_UNAVAILABLE",
    );

    assert.equal(attempts, 3);
    assert.deepEqual(delays, [
      250,
      500,
    ]);
  },
);

test(
  "does not retry or expose an unexpected provider failure",
  async () => {
    let attempts = 0;
    const delays: number[] = [];
    const privateProviderText =
      "private unexpected provider detail";

    const client = createClient(
      async () => {
        attempts += 1;
        throw new Error(
          privateProviderText,
        );
      },
    );

    const engine =
      new OpenAIIntelligenceEngine({
        config: createConfig({
          maxRetries: 3,
        }),
        client,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
      });

    await assertEngineError(
      engine.analyze(createRequest()),
      "OPENAI_REQUEST_FAILED",
      privateProviderText,
    );

    assert.equal(attempts, 1);
    assert.deepEqual(delays, []);
  },
);
