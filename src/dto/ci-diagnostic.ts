import {
  z,
} from "zod";

import {
  ciConclusionSchema,
} from "./ci-evidence.js";

export const maximumCiDiagnosticFiles = 50;
export const maximumCiDiagnosticEvidence = 20;
export const maximumCiDiagnosticActions = 20;

export const ciFailureCategorySchema = z.enum([
  "TEST_FAILURE",
  "TYPE_CHECK_FAILURE",
  "BUILD_FAILURE",
  "DEPENDENCY_FAILURE",
  "SECURITY_SCAN_FAILURE",
  "INFRASTRUCTURE_FAILURE",
  "FLAKY_OR_INCONCLUSIVE_FAILURE",
]);

export const ciDiagnosticConfidenceSchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
]);

export const ciRetryRecommendationSchema = z.enum([
  "RETRY",
  "RETRY_AFTER_FIX",
  "DO_NOT_RETRY",
  "MANUAL_REVIEW",
]);

const relevantChangedFilesSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(500),
  )
  .max(maximumCiDiagnosticFiles);

const recommendedActionsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(500),
  )
  .max(maximumCiDiagnosticActions);

export const advisoryCiDiagnosisSchema = z
  .object({
    failureCategory:
      ciFailureCategorySchema,
    probableCause: z
      .string()
      .trim()
      .min(1)
      .max(2_000),
    relevantChangedFiles:
      relevantChangedFilesSchema,
    confidence:
      ciDiagnosticConfidenceSchema,
    recommendedActions:
      recommendedActionsSchema,
    retryRecommendation:
      ciRetryRecommendationSchema,
  })
  .strict();

export const ciDiagnosticEvidenceSchema = z
  .object({
    jobName: z
      .string()
      .trim()
      .min(1)
      .max(300),
    stepName: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .nullable(),
    conclusion: ciConclusionSchema,
    logEvidenceAvailable: z.boolean(),
  })
  .strict();

export const ciDiagnosticSchema = z
  .object({
    failureCategory:
      ciFailureCategorySchema,
    probableCause: z
      .string()
      .trim()
      .min(1)
      .max(2_000),
    relevantChangedFiles:
      relevantChangedFilesSchema,
    supportingEvidence: z
      .array(ciDiagnosticEvidenceSchema)
      .min(1)
      .max(maximumCiDiagnosticEvidence),
    confidence:
      ciDiagnosticConfidenceSchema,
    recommendedActions:
      recommendedActionsSchema
        .min(1),
    retryRecommendation:
      ciRetryRecommendationSchema,
    affectsReleaseApproval: z.boolean(),
    classificationSource: z.enum([
      "DETERMINISTIC",
      "INTELLIGENCE",
    ]),
  })
  .strict();

export type AdvisoryCiDiagnosis = z.infer<
  typeof advisoryCiDiagnosisSchema
>;

export type CiDiagnosticDto = z.infer<
  typeof ciDiagnosticSchema
>;

export function parseCiDiagnostic(
  input: unknown,
): CiDiagnosticDto {
  return ciDiagnosticSchema.parse(input);
}
