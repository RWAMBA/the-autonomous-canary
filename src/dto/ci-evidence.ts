import {
  z,
} from "zod";

export const maximumCiJobs = 50;
export const maximumCiStepsPerJob = 100;
export const maximumCiLogExcerptLength = 8_000;
export const maximumCiLogCharacters = 40_000;

const maximumGitHubIdentifier =
  Number.MAX_SAFE_INTEGER;

export const ciConclusionSchema = z.enum([
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "stale",
  "startup_failure",
]);

export const ciStepEvidenceSchema = z
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
    logExcerpt: z
      .string()
      .min(1)
      .max(maximumCiLogExcerptLength)
      .optional(),
  })
  .strict();

export const ciJobEvidenceSchema = z
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
    steps: z
      .array(ciStepEvidenceSchema)
      .max(maximumCiStepsPerJob)
      .default([]),
  })
  .strict()
  .superRefine((job, context) => {
    const observedStepNumbers =
      new Set<number>();

    for (const [index, step] of
      job.steps.entries()) {
      if (
        observedStepNumbers.has(
          step.number,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: [
            "steps",
            index,
            "number",
          ],
          message:
            "CI step numbers must be unique within a job.",
        });
      }

      observedStepNumbers.add(
        step.number,
      );
    }
  });

export const ciEvidenceSchema = z
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
    jobs: z
      .array(ciJobEvidenceSchema)
      .min(1)
      .max(maximumCiJobs),
  })
  .strict()
  .superRefine((evidence, context) => {
    const observedJobIds =
      new Set<number>();
    let totalLogCharacters = 0;

    for (const [jobIndex, job] of
      evidence.jobs.entries()) {
      if (observedJobIds.has(job.jobId)) {
        context.addIssue({
          code: "custom",
          path: [
            "jobs",
            jobIndex,
            "jobId",
          ],
          message:
            "CI job identifiers must be unique within a workflow run.",
        });
      }

      observedJobIds.add(job.jobId);

      for (const step of job.steps) {
        totalLogCharacters +=
          step.logExcerpt?.length ?? 0;
      }
    }

    if (
      totalLogCharacters
      > maximumCiLogCharacters
    ) {
      context.addIssue({
        code: "custom",
        path: [
          "jobs",
        ],
        message:
          `Combined CI log excerpts must not exceed ${maximumCiLogCharacters} characters.`,
      });
    }
  });

export type CiConclusion = z.infer<
  typeof ciConclusionSchema
>;

export type CiStepEvidenceDto = z.infer<
  typeof ciStepEvidenceSchema
>;

export type CiJobEvidenceDto = z.infer<
  typeof ciJobEvidenceSchema
>;

export type CiEvidenceDto = z.infer<
  typeof ciEvidenceSchema
>;

export function parseCiEvidence(
  input: unknown,
): CiEvidenceDto {
  return ciEvidenceSchema.parse(input);
}
