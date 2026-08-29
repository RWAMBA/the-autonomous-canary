import {
  z,
} from "zod";

import {
  ciConclusionSchema,
  maximumCiJobs,
  maximumCiStepsPerJob,
} from "./ci-evidence.js";

const maximumGitHubIdentifier =
  Number.MAX_SAFE_INTEGER;

export const ciInvestigationOutcomeSchema =
  z.enum([
    "PASSED",
    "FAILED",
    "INCOMPLETE",
  ]);

const ciProblemStepSchema = z
  .object({
    number: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    name: z
      .string()
      .trim()
      .min(1)
      .max(300),
    conclusion: ciConclusionSchema,
  })
  .strict();

const ciProblemJobSchema = z
  .object({
    jobId: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    name: z
      .string()
      .trim()
      .min(1)
      .max(300),
    conclusion: ciConclusionSchema,
    problemSteps: z
      .array(ciProblemStepSchema)
      .max(maximumCiStepsPerJob),
  })
  .strict();

export const ciInvestigationSchema = z
  .object({
    provider: z.literal(
      "GITHUB_ACTIONS",
    ),
    workflowName: z
      .string()
      .trim()
      .min(1)
      .max(300),
    runId: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    runAttempt: z
      .number()
      .int()
      .positive()
      .max(1_000),
    conclusion: ciConclusionSchema,
    outcome:
      ciInvestigationOutcomeSchema,
    summary: z
      .object({
        totalJobs: z
          .number()
          .int()
          .nonnegative()
          .max(maximumCiJobs),
        failedJobs: z
          .number()
          .int()
          .nonnegative()
          .max(maximumCiJobs),
        incompleteJobs: z
          .number()
          .int()
          .nonnegative()
          .max(maximumCiJobs),
        failedSteps: z
          .number()
          .int()
          .nonnegative(),
        incompleteSteps: z
          .number()
          .int()
          .nonnegative(),
      })
      .strict(),
    problemJobs: z
      .array(ciProblemJobSchema)
      .max(maximumCiJobs),
  })
  .strict();

export type CiInvestigationDto = z.infer<
  typeof ciInvestigationSchema
>;

export function parseCiInvestigation(
  input: unknown,
): CiInvestigationDto {
  return ciInvestigationSchema.parse(input);
}
