import {
  z,
} from "zod";

import {
  ciConclusionSchema,
} from "../dto/ci-evidence.js";
import {
  githubDeliveryIdPattern,
} from "../dto/github-webhook.js";
import {
  gitShaSchema,
  reviewRepositorySchema,
} from "../dto/review-request.js";

const maximumGitHubIdentifier =
  Number.MAX_SAFE_INTEGER;

export const githubWorkflowRunTaskSchema =
  z
    .object({
      deliveryId: z
        .string()
        .regex(githubDeliveryIdPattern),
      releaseId: z
        .uuid()
        .optional(),
      installationId: z
        .number()
        .int()
        .positive()
        .max(maximumGitHubIdentifier),
      repository:
        reviewRepositorySchema,
      workflowRun: z
        .object({
          id: z
            .number()
            .int()
            .positive()
            .max(maximumGitHubIdentifier),
          runAttempt: z
            .number()
            .int()
            .positive()
            .max(1_000),
          headSha: gitShaSchema,
          conclusion:
            ciConclusionSchema,
        })
        .strict(),
      pullRequest: z
        .object({
          number: z
            .number()
            .int()
            .positive()
            .max(maximumGitHubIdentifier),
        })
        .strict(),
    })
    .strict();

export type GitHubWorkflowRunTask =
  z.infer<
    typeof githubWorkflowRunTaskSchema
  >;

export interface GitHubWorkflowRunTaskDispatcher {
  dispatch(
    task: GitHubWorkflowRunTask,
  ): void;
}

export function parseGitHubWorkflowRunTask(
  input: unknown,
): GitHubWorkflowRunTask {
  return githubWorkflowRunTaskSchema
    .parse(input);
}
