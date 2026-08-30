import {
  z,
} from "zod";

import {
  ciInvestigationSchema,
} from "./ci-investigation.js";
import {
  ciDiagnosticSchema,
} from "./ci-diagnostic.js";

const gitShaPattern = /^[a-f0-9]{7,64}$/i;
const repositoryPartPattern = /^[a-z0-9._-]+$/i;
const reviewCodePattern = /^[A-Z0-9_]+$/;

const repositoryPartSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(repositoryPartPattern);

const reviewCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(reviewCodePattern);

export const reviewDecisionSchema = z.enum([
  "CONTINUE",
  "BLOCK",
]);

export const reviewRiskLevelSchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

export const reviewFindingSourceSchema = z.enum([
  "DETERMINISTIC",
  "INTELLIGENCE",
  "POLICY",
]);

export const reviewFindingSchema = z
  .object({
    code: reviewCodeSchema,
    source: reviewFindingSourceSchema,
    severity: reviewRiskLevelSchema,
    title: z
      .string()
      .trim()
      .min(1)
      .max(300),
    explanation: z
      .string()
      .trim()
      .min(1)
      .max(2_000),
    file: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional(),
  })
  .strict();

const blockedDeploymentSchema = z
  .object({
    strategy: z.literal("BLOCKED"),
    initialTrafficPercent: z.literal(0),
  })
  .strict();

const canaryDeploymentSchema = z
  .object({
    strategy: z.literal("CANARY"),
    initialTrafficPercent: z
      .number()
      .int()
      .min(1)
      .max(99),
  })
  .strict();

const standardDeploymentSchema = z
  .object({
    strategy: z.literal("STANDARD"),
    initialTrafficPercent: z.literal(100),
  })
  .strict();

const commonReviewResponseFields = {
  reviewId: z.uuid(),
  repository: z
    .object({
      owner: repositoryPartSchema,
      name: repositoryPartSchema,
    })
    .strict(),
  headSha: z
    .string()
    .trim()
    .regex(gitShaPattern),
  risk: z
    .object({
      score: z
        .number()
        .int()
        .min(0)
        .max(100),
      level: reviewRiskLevelSchema,
    })
    .strict(),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(2_000),
  findings: z
    .array(reviewFindingSchema)
    .max(200),
  requiredActions: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(500),
    )
    .max(50),
  policyOverrides: z
    .array(reviewCodeSchema)
    .max(50),
  ciInvestigation:
    ciInvestigationSchema.optional(),
  ciDiagnostic:
    ciDiagnosticSchema.optional(),
  analysis: z
    .object({
      provider: z.enum([
        "MOCK",
        "OPENAI",
      ]),
      modelTarget: z
        .string()
        .trim()
        .min(1)
        .max(200),
      promptVersion: z
        .string()
        .trim()
        .min(1)
        .max(100),
    })
    .strict(),
};

export const reviewResponseSchema = z.discriminatedUnion(
  "decision",
  [
    z
      .object({
        ...commonReviewResponseFields,
        decision: z.literal("BLOCK"),
        deployment: blockedDeploymentSchema,
      })
      .strict(),
    z
      .object({
        ...commonReviewResponseFields,
        decision: z.literal("CONTINUE"),
        deployment: z.union([
          canaryDeploymentSchema,
          standardDeploymentSchema,
        ]),
      })
      .strict(),
  ],
);

export type ReviewDecision = z.infer<
  typeof reviewDecisionSchema
>;

export type ReviewRiskLevel = z.infer<
  typeof reviewRiskLevelSchema
>;

export type ReviewFinding = z.infer<
  typeof reviewFindingSchema
>;

export type ReviewResponseDto = z.infer<
  typeof reviewResponseSchema
>;

export function parseReviewResponse(
  input: unknown,
): ReviewResponseDto {
  return reviewResponseSchema.parse(input);
}
