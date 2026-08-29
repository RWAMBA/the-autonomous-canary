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

const repositoryPartSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(repositoryPartPattern);

const gitShaSchema = z
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

export const reviewRequestSchema = z
  .object({
    repository: z
      .object({
        owner: repositoryPartSchema,
        name: repositoryPartSchema,
      })
      .strict(),
    change: z
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
      .strict(),
    evidence: z
      .object({
        testStatus: testStatusSchema,
        securityFindings: z
          .array(securityFindingSchema)
          .max(maximumSecurityFindings)
          .default([]),
        ci: ciEvidenceSchema.optional(),
      })
      .strict(),
  })
  .strict();

export type ReviewRequestDto = z.infer<
  typeof reviewRequestSchema
>;

export function parseReviewRequest(
  input: unknown,
): ReviewRequestDto {
  return reviewRequestSchema.parse(input);
}
