import {
  performance,
} from "node:perf_hooks";

import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from "openai";
import {
  zodTextFormat,
} from "openai/helpers/zod";

import type {
  ReviewRequestDto,
} from "../../dto/review-request.js";
import {
  intelligenceAssessmentSchema,
  parseIntelligenceResult,
} from "./intelligence-engine.js";
import type {
  IntelligenceEngine,
  IntelligenceResult,
} from "./intelligence-engine.js";
import type {
  OpenAIIntelligenceConfig,
} from "./openai-intelligence-config.js";
import {
  estimateOpenAIIntelligenceCost,
} from "./openai-intelligence-cost.js";
import type {
  OpenAICostEstimate,
} from "./openai-intelligence-cost.js";
import {
  buildReviewPrompt,
} from "./review-prompt.js";

export const openAIIntelligenceResponseSchemaName =
  "canaryguard_intelligence_assessment";

export const openAIRetryBaseDelayMs = 250;
export const openAIRetryMaximumDelayMs = 2_000;

export type OpenAIIntelligenceErrorCode =
  | "OPENAI_INCOMPLETE_RESPONSE"
  | "OPENAI_INVALID_RESPONSE"
  | "OPENAI_PROVIDER_UNAVAILABLE"
  | "OPENAI_REFUSAL"
  | "OPENAI_REQUEST_FAILED"
  | "OPENAI_TIMEOUT";

const errorMessages: Readonly<
  Record<
    OpenAIIntelligenceErrorCode,
    string
  >
> = Object.freeze({
  OPENAI_INCOMPLETE_RESPONSE:
    "The intelligence provider returned an incomplete review.",
  OPENAI_INVALID_RESPONSE:
    "The intelligence provider returned an invalid review.",
  OPENAI_PROVIDER_UNAVAILABLE:
    "The intelligence provider is temporarily unavailable.",
  OPENAI_REFUSAL:
    "The intelligence provider refused the review.",
  OPENAI_REQUEST_FAILED:
    "The intelligence provider request failed.",
  OPENAI_TIMEOUT:
    "The intelligence provider timed out.",
});

export class OpenAIIntelligenceError
extends Error {
  readonly code:
    OpenAIIntelligenceErrorCode;

  constructor(
    code: OpenAIIntelligenceErrorCode,
  ) {
    super(errorMessages[code]);
    this.name = "OpenAIIntelligenceError";
    this.code = code;
  }
}

export type OpenAIIntelligenceClock =
  () => number;

export type OpenAIIntelligenceSleep =
  (delayMs: number) => Promise<void>;

export interface OpenAIIntelligenceEngineOptions {
  readonly config:
    OpenAIIntelligenceConfig;
  readonly client?: OpenAI;
  readonly now?:
    OpenAIIntelligenceClock;
  readonly sleep?:
    OpenAIIntelligenceSleep;
}

interface OpenAIOutputContentItem {
  readonly type: string;
}

interface OpenAIOutputItem {
  readonly type: string;
  readonly content?: readonly OpenAIOutputContentItem[];
}

function defaultNow(): number {
  return performance.now();
}

async function defaultSleep(
  delayMs: number,
): Promise<void> {
  await new Promise<void>(
    (resolve) => {
      setTimeout(resolve, delayMs);
    },
  );
}

function calculateRetryDelayMs(
  failedAttempt: number,
): number {
  return Math.min(
    openAIRetryBaseDelayMs
      * (2 ** (failedAttempt - 1)),
    openAIRetryMaximumDelayMs,
  );
}

function isRetryableProviderError(
  error: unknown,
): boolean {
  if (
    error instanceof APIConnectionError
  ) {
    return true;
  }

  if (!(error instanceof APIError)) {
    return false;
  }

  const { status } = error;

  return status === 408
    || status === 409
    || status === 429
    || (
      typeof status === "number"
      && status >= 500
    );
}

function responseContainsRefusal(
  output: readonly OpenAIOutputItem[],
): boolean {
  return output.some(
    (item) =>
      item.type === "message"
      && item.content?.some(
        (content) =>
          content.type === "refusal",
      ) === true,
  );
}

export class OpenAIIntelligenceEngine
implements IntelligenceEngine {
  private readonly client: OpenAI;

  private readonly model:
    OpenAIIntelligenceConfig["model"];

  private readonly timeoutMs: number;

  private readonly maxRetries: number;

  private readonly maxOutputTokens: number;

  private readonly now:
    OpenAIIntelligenceClock;

  private readonly sleep:
    OpenAIIntelligenceSleep;

  constructor(
    options:
      OpenAIIntelligenceEngineOptions,
  ) {
    const { config } = options;

    this.client = options.client
      ?? new OpenAI({
        apiKey: config.apiKey,
        maxRetries: 0,
        timeout: config.timeoutMs,
      });

    this.model = config.model;
    this.timeoutMs = config.timeoutMs;
    this.maxRetries = config.maxRetries;
    this.maxOutputTokens =
      config.maxOutputTokens;
    this.now = options.now ?? defaultNow;
    this.sleep =
      options.sleep ?? defaultSleep;
  }

  async analyze(
    sanitizedRequest: ReviewRequestDto,
  ): Promise<IntelligenceResult> {
    const prompt = buildReviewPrompt(
      sanitizedRequest,
    );

    const startedAt = this.now();
    const maximumAttempts =
      this.maxRetries + 1;

    for (
      let attempt = 1;
      attempt <= maximumAttempts;
      attempt += 1
    ) {
      try {
        const response =
          await this.client.responses.parse(
            {
              model: this.model,
              instructions:
                prompt.instructions,
              input: prompt.input,
              max_output_tokens:
                this.maxOutputTokens,
              store: false,
              text: {
                format: zodTextFormat(
                  intelligenceAssessmentSchema,
                  openAIIntelligenceResponseSchemaName,
                ),
              },
            },
            {
              timeout: this.timeoutMs,
            },
          );

        if (
          responseContainsRefusal(
            response.output,
          )
        ) {
          throw new OpenAIIntelligenceError(
            "OPENAI_REFUSAL",
          );
        }

        if (
          response.status === "incomplete"
          || response.incomplete_details
            !== null
        ) {
          throw new OpenAIIntelligenceError(
            "OPENAI_INCOMPLETE_RESPONSE",
          );
        }

        if (
          response.status !== "completed"
          || response.output_parsed
            === null
          || response.usage === null
          || response.usage
            === undefined
        ) {
          throw new OpenAIIntelligenceError(
            "OPENAI_INVALID_RESPONSE",
          );
        }

        const assessment =
          intelligenceAssessmentSchema
            .safeParse(
              response.output_parsed,
            );

        if (!assessment.success) {
          throw new OpenAIIntelligenceError(
            "OPENAI_INVALID_RESPONSE",
          );
        }

        const usage = response.usage;
        const inputTokens =
          usage.input_tokens;
        const cachedInputTokens =
          usage.input_tokens_details
            .cached_tokens;
        const cacheWriteInputTokens =
          usage.input_tokens_details
            .cache_write_tokens;
        const outputTokens =
          usage.output_tokens;
        const reasoningTokens =
          usage.output_tokens_details
            .reasoning_tokens;

        let costEstimate:
          OpenAICostEstimate;

        try {
          costEstimate =
            estimateOpenAIIntelligenceCost({
              inputTokens,
              cachedInputTokens,
              cacheWriteInputTokens,
              outputTokens,
            });
        } catch {
          throw new OpenAIIntelligenceError(
            "OPENAI_INVALID_RESPONSE",
          );
        }

        const latencyMs = Math.max(
          0,
          this.now() - startedAt,
        );

        try {
          return parseIntelligenceResult({
            assessment: assessment.data,
            telemetry: {
              provider: "OPENAI",
              modelTarget: this.model,
              promptVersion:
                prompt.promptVersion,
              inputTokens,
              cachedInputTokens,
              cacheWriteInputTokens,
              outputTokens,
              reasoningTokens,
              totalTokens:
                usage.total_tokens,
              latencyMs,
              attempts: attempt,
              estimatedCostUsd:
                costEstimate
                  .estimatedCostUsd,
              pricingVersion:
                costEstimate
                  .pricingVersion,
            },
          });
        } catch {
          throw new OpenAIIntelligenceError(
            "OPENAI_INVALID_RESPONSE",
          );
        }
      } catch (error) {
        if (
          error
          instanceof OpenAIIntelligenceError
        ) {
          throw error;
        }

        const retryable =
          isRetryableProviderError(error);

        if (
          retryable
          && attempt < maximumAttempts
        ) {
          await this.sleep(
            calculateRetryDelayMs(
              attempt,
            ),
          );
          continue;
        }

        if (
          error
          instanceof APIConnectionTimeoutError
        ) {
          throw new OpenAIIntelligenceError(
            "OPENAI_TIMEOUT",
          );
        }

        throw new OpenAIIntelligenceError(
          retryable
            ? "OPENAI_PROVIDER_UNAVAILABLE"
            : "OPENAI_REQUEST_FAILED",
        );
      }
    }

    throw new OpenAIIntelligenceError(
      "OPENAI_PROVIDER_UNAVAILABLE",
    );
  }
}
