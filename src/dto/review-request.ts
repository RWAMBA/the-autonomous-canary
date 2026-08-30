import {
  z,
} from "zod";

import {
  ciEvidenceSchema,
} from "./ci-evidence.js";

export const maximumDiffLength = 200_000;
export const maximumSecurityFindings = 100;

const gitShaPattern = /^[a-f0-9]{7,64}$/i;
const repositoryPartPattern = /^[a-z0-9._-]+$/i;

export const repositoryPartSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(repositoryPartPattern);

export const gitShaSchema = z
  .string()
  .trim()
  .regex(gitShaPattern);

export const testStatusSchema = z.enum([
  "passed",
  "failed",
  "unknown",
]);

export const securitySeveritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

export const securityFindingSchema = z
  .object({
    identifier: z
      .string()
      .trim()
      .min(1)
      .max(200),
    source: z
      .string()
      .trim()
      .min(1)
      .max(100),
    severity: securitySeveritySchema,
    title: z
      .string()
      .trim()
      .min(1)
      .max(300),
    file: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional(),
  })
  .strict();

export const reviewRepositorySchema = z
  .object({
    owner: repositoryPartSchema,
    name: repositoryPartSchema,
  })
  .strict();

export const reviewChangeSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(256),
    description: z
      .string()
      .trim()
      .max(4_000)
      .optional(),
    baseSha: gitShaSchema,
    headSha: gitShaSchema,
    diff: z
      .string()
      .min(1)
      .max(maximumDiffLength),
  })
  .strict();

export const reviewEvidenceWithoutCiSchema = z
  .object({
    testStatus: testStatusSchema,
    securityFindings: z
      .array(securityFindingSchema)
      .max(maximumSecurityFindings)
      .default([]),
  })
  .strict();

export const reviewEvidenceSchema =
  reviewEvidenceWithoutCiSchema
    .extend({
      ci: ciEvidenceSchema.optional(),
    })
    .strict();

export const reviewRequestSchema = z
  .object({
    repository: reviewRepositorySchema,
    change: reviewChangeSchema,
    evidence: reviewEvidenceSchema,
  })
  .strict();

export type ReviewRequestDto = z.infer<
  typeof reviewRequestSchema
>;

export type ReviewChangeDto = z.infer<
  typeof reviewChangeSchema
>;

export type TestStatus = z.infer<
  typeof testStatusSchema
>;

export function parseReviewRequest(
  input: unknown,
): ReviewRequestDto {
  return reviewRequestSchema.parse(input);
}
