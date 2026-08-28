import {
  z,
} from "zod";

import type {
  ReviewRequestDto,
} from "../../dto/review-request.js";
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

export const intelligenceTelemetrySchema = z
  .object({
    provider: z.enum([
      "MOCK",
      "OPENAI",
    ]),
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
  })
  .strict();

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
