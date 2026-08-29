import {
  z,
} from "zod";

import {
  reviewChangeSchema,
  reviewEvidenceWithoutCiSchema,
  reviewRepositorySchema,
} from "./review-request.js";

const maximumGitHubIdentifier =
  Number.MAX_SAFE_INTEGER;

export const githubReviewRequestSchema = z
  .object({
    repository: reviewRepositorySchema,
    change: reviewChangeSchema,
    evidence:
      reviewEvidenceWithoutCiSchema,
    github: z
      .object({
        runId: z
          .number()
          .int()
          .positive()
          .max(maximumGitHubIdentifier),
      })
      .strict(),
  })
  .strict();

export type GitHubReviewRequestDto =
  z.infer<
    typeof githubReviewRequestSchema
  >;

export function parseGitHubReviewRequest(
  input: unknown,
): GitHubReviewRequestDto {
  return githubReviewRequestSchema.parse(
    input,
  );
}
