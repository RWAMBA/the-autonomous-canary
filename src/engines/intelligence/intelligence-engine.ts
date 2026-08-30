import {
  z,
} from "zod";

import type {
  ReviewRequestDto,
} from "../../dto/review-request.js";
import {
  advisoryCiDiagnosisSchema,
} from "../../dto/ci-diagnostic.js";
import {
  reviewRiskLevelSchema,
} from "../../dto/review-response.js";

export const intelligenceFindingCategorySchema =
  z.enum([
    "SECURITY",
    "RELIABILITY",
    "PERFORMANCE",
    "OPERABILITY",
    "CHANGE_SCOPE",
  ]);

export const intelligenceFindingSchema = z
  .object({
    category:
      intelligenceFindingCategorySchema,
    severity: reviewRiskLevelSchema,
    title: z
      .string()
      .min(1)
      .max(300),
    explanation: z
      .string()
      .min(1)
      .max(2_000),
    file: z
      .string()
      .min(1)
      .max(500)
      .nullable(),
  })
  .strict();

export const intelligenceAssessmentSchema = z
  .object({
    advisoryDecision: z.enum([
      "CONTINUE",
      "BLOCK",
    ]),
    riskScore: z
      .number()
      .int()
      .min(0)
      .max(100),
    riskLevel: reviewRiskLevelSchema,
    summary: z
      .string()
      .min(1)
      .max(2_000),
    findings: z
      .array(intelligenceFindingSchema)
      .max(100),
    requiredActions: z
      .array(
        z
          .string()
          .min(1)
          .max(500),
      )
      .max(50),
    ciDiagnosis:
      advisoryCiDiagnosisSchema.nullable(),
    advisoryDeployment: z
      .object({
        strategy: z.enum([
          "BLOCKED",
          "CANARY",
          "STANDARD",
        ]),
        initialTrafficPercent: z
          .number()
          .int()
          .min(0)
          .max(100),
      })
      .strict(),
  })
  .strict();

const intelligenceTelemetryCommonShape = {
  modelTarget: z
    .string()
    .min(1)
    .max(200),
  promptVersion: z
    .string()
    .min(1)
    .max(100),
  inputTokens: z
    .number()
    .int()
    .nonnegative(),
  outputTokens: z
    .number()
    .int()
    .nonnegative(),
  totalTokens: z
    .number()
    .int()
    .nonnegative(),
  latencyMs: z
    .number()
    .nonnegative(),
  attempts: z
    .number()
    .int()
    .min(1)
    .max(10),
} as const;

export const mockIntelligenceTelemetrySchema =
  z
    .object({
      provider: z.literal("MOCK"),
      ...intelligenceTelemetryCommonShape,
    })
    .strict();

export const openAIIntelligenceTelemetrySchema =
  z
    .object({
      provider: z.literal("OPENAI"),
      ...intelligenceTelemetryCommonShape,
      cachedInputTokens: z
        .number()
        .int()
        .nonnegative(),
      cacheWriteInputTokens: z
        .number()
        .int()
        .nonnegative(),
      reasoningTokens: z
        .number()
        .int()
        .nonnegative(),
      estimatedCostUsd: z
        .number()
        .finite()
        .nonnegative(),
      pricingVersion: z
        .string()
        .min(1)
        .max(100),
    })
    .strict();

export const intelligenceTelemetrySchema =
  z
    .discriminatedUnion(
      "provider",
      [
        mockIntelligenceTelemetrySchema,
        openAIIntelligenceTelemetrySchema,
      ],
    )
    .superRefine(
      (telemetry, context) => {
        if (
          telemetry.provider !== "OPENAI"
        ) {
          return;
        }

        if (
          (
            telemetry.cachedInputTokens
            + telemetry.cacheWriteInputTokens
          )
          > telemetry.inputTokens
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "inputTokens",
            ],
            message:
              "Cached and cache-write tokens cannot exceed total input tokens.",
          });
        }

        if (
          telemetry.reasoningTokens
          > telemetry.outputTokens
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "reasoningTokens",
            ],
            message:
              "Reasoning tokens cannot exceed total output tokens.",
          });
        }

        if (
          telemetry.totalTokens
          !== (
            telemetry.inputTokens
            + telemetry.outputTokens
          )
        ) {
          context.addIssue({
            code: "custom",
            path: [
              "totalTokens",
            ],
            message:
              "Total tokens must equal input tokens plus output tokens.",
          });
        }
      },
    );

export const intelligenceResultSchema = z
  .object({
    assessment:
      intelligenceAssessmentSchema,
    telemetry:
      intelligenceTelemetrySchema,
  })
  .strict();

export type IntelligenceFinding = z.infer<
  typeof intelligenceFindingSchema
>;

export type IntelligenceAssessment = z.infer<
  typeof intelligenceAssessmentSchema
>;

export type IntelligenceTelemetry = z.infer<
  typeof intelligenceTelemetrySchema
>;

export type IntelligenceResult = z.infer<
  typeof intelligenceResultSchema
>;

export interface IntelligenceEngine {
  analyze(
    sanitizedRequest: ReviewRequestDto,
  ): Promise<IntelligenceResult>;
}

export function parseIntelligenceResult(
  input: unknown,
): IntelligenceResult {
  return intelligenceResultSchema.parse(input);
}
