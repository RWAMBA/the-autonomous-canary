import {
  z,
} from "zod";

import {
  ciConclusionSchema,
} from "./ci-evidence.js";
import {
  gitShaSchema,
  repositoryPartSchema,
} from "./review-request.js";

const maximumGitHubIdentifier =
  Number.MAX_SAFE_INTEGER;

export const githubDeliveryIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export const githubWorkflowRunActionSchema =
  z.enum([
    "requested",
    "in_progress",
    "completed",
  ]);

export const githubPullRequestActionSchema =
  z.enum([
    "opened",
    "reopened",
    "synchronize",
    "ready_for_review",
    "closed",
  ]);

const githubWorkflowRunStatusSchema =
  z.enum([
    "requested",
    "queued",
    "in_progress",
    "waiting",
    "pending",
    "completed",
  ]);

const githubRepositorySchema = z
  .object({
    id: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    full_name: z
      .string()
      .trim()
      .min(3)
      .max(201),
    name: repositoryPartSchema,
    owner: z
      .object({
        login: repositoryPartSchema,
      }),
  });

const githubWorkflowRunSchema = z
  .object({
    id: z
      .number()
      .int()
      .positive()
      .max(maximumGitHubIdentifier),
    name: z
      .string()
      .trim()
      .min(1)
      .max(300),
    status:
      githubWorkflowRunStatusSchema,
    conclusion:
      ciConclusionSchema.nullable(),
    run_attempt: z
      .number()
      .int()
      .positive()
      .max(1_000),
    head_sha: gitShaSchema,
    head_commit: z
      .object({
        id: gitShaSchema,
      })
      .nullable()
      .optional(),
    repository:
      githubRepositorySchema,
    pull_requests: z
      .array(
        z
          .object({
            number: z
              .number()
              .int()
              .positive()
              .max(
                maximumGitHubIdentifier,
              ),
          }),
      )
      .max(20)
      .default([]),
  });

export const githubPullRequestWebhookSchema =
  z
    .object({
      action:
        githubPullRequestActionSchema,
      number: z
        .number()
        .int()
        .positive()
        .max(maximumGitHubIdentifier),
      installation: z
        .object({
          id: z
            .number()
            .int()
            .positive()
            .max(
              maximumGitHubIdentifier,
            ),
        }),
      repository:
        githubRepositorySchema,
      pull_request: z
        .object({
          number: z
            .number()
            .int()
            .positive()
            .max(
              maximumGitHubIdentifier,
            ),
          state: z.enum([
            "open",
            "closed",
          ]),
          draft: z.boolean(),
          title: z
            .string()
            .trim()
            .min(1)
            .max(500),
          created_at:
            z.iso.datetime(),
          closed_at: z
            .iso.datetime()
            .nullable(),
          head: z.object({
            sha: gitShaSchema,
          }),
          base: z.object({
            sha: gitShaSchema,
          }),
        }),
    })
    .superRefine((value, context) => {
      if (
        value.number
        !== value.pull_request.number
      ) {
        context.addIssue({
          code: "custom",
          path: [
            "pull_request",
            "number",
          ],
          message:
            "The pull request number must match the webhook number.",
        });
      }

      if (
        value.action === "closed"
        && value.pull_request.state
          !== "closed"
      ) {
        context.addIssue({
          code: "custom",
          path: [
            "pull_request",
            "state",
          ],
          message:
            "A closed action must contain a closed pull request.",
        });
      }
    });

export const githubWorkflowRunWebhookSchema =
  z
    .object({
      action:
        githubWorkflowRunActionSchema,
      installation: z
        .object({
          id: z
            .number()
            .int()
            .positive()
            .max(
              maximumGitHubIdentifier,
            ),
        }),
      repository:
        githubRepositorySchema,
      workflow_run:
        githubWorkflowRunSchema,
    })
    .superRefine((value, context) => {
      if (
        value.action === "completed"
        && value.workflow_run.status
          !== "completed"
      ) {
        context.addIssue({
          code: "custom",
          path: [
            "workflow_run",
            "status",
          ],
          message:
            "A completed workflow_run delivery must report completed status.",
        });
      }

      if (
        value.action === "completed"
        && value.workflow_run.conclusion
          === null
      ) {
        context.addIssue({
          code: "custom",
          path: [
            "workflow_run",
            "conclusion",
          ],
          message:
            "A completed workflow_run delivery must report a conclusion.",
        });
      }
    });

const receiptRepositorySchema = z
  .object({
    owner: repositoryPartSchema,
    name: repositoryPartSchema,
  })
  .strict();

const receiptWorkflowRunSchema = z
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
      ciConclusionSchema.nullable(),
  })
  .strict();

const workflowRunReceiptSchema = z
    .object({
      deliveryId: z
        .string()
        .regex(githubDeliveryIdPattern),
      event: z.literal(
        "workflow_run",
      ),
      status: z.enum([
        "ACCEPTED",
        "IGNORED",
      ]),
      reason: z
        .enum([
          "WORKFLOW_RUN_NOT_COMPLETED",
          "WORKFLOW_RUN_PULL_REQUEST_UNAVAILABLE",
          "WORKFLOW_RUN_PULL_REQUEST_CLOSED",
          "WORKFLOW_RUN_HEAD_SUPERSEDED",
        ])
        .optional(),
      repository:
        receiptRepositorySchema,
      workflowRun:
        receiptWorkflowRunSchema,
    })
    .strict()
    .superRefine((value, context) => {
      const validAcceptedReceipt =
        value.status === "ACCEPTED"
        && value.reason === undefined
        && value.workflowRun.conclusion
          !== null;

      const validIgnoredReceipt =
        value.status === "IGNORED"
        && value.reason !== undefined;

      if (
        !validAcceptedReceipt
        && !validIgnoredReceipt
      ) {
        context.addIssue({
          code: "custom",
          path: [
            "status",
          ],
          message:
            "GitHub webhook receipt fields are inconsistent.",
        });
      }
    });

export const githubCheckRunActionSchema =
  z.enum([
    "created",
    "completed",
  ]);

export const githubCheckRunWebhookSchema =
  z
    .object({
      action: githubCheckRunActionSchema,
      repository:
        githubRepositorySchema,
    });

const checkRunReceiptSchema = z
  .object({
    deliveryId: z
      .string()
      .regex(githubDeliveryIdPattern),
    event: z.literal("check_run"),
    status: z.literal("IGNORED"),
    reason: z.literal(
      "CHECK_RUN_EVENT_IGNORED",
    ),
    repository:
      receiptRepositorySchema,
  })
  .strict();

const pullRequestReceiptSchema = z
  .object({
    deliveryId: z
      .string()
      .regex(githubDeliveryIdPattern),
    event: z.literal("pull_request"),
    status: z.literal("ACCEPTED"),
    repository:
      receiptRepositorySchema,
    pullRequest: z
      .object({
        number: z
          .number()
          .int()
          .positive()
          .max(
            maximumGitHubIdentifier,
          ),
        headSha: gitShaSchema,
        state: z.enum([
          "OPEN",
          "CLOSED",
        ]),
      })
      .strict(),
    releaseId: z.uuid(),
  })
  .strict();

export const githubWebhookReceiptSchema =
  z.discriminatedUnion("event", [
    pullRequestReceiptSchema,
    workflowRunReceiptSchema,
    checkRunReceiptSchema,
  ]);

export type GitHubPullRequestWebhookDto =
  z.infer<
    typeof githubPullRequestWebhookSchema
  >;

export type GitHubWorkflowRunWebhookDto =
  z.infer<
    typeof githubWorkflowRunWebhookSchema
  >;

export type GitHubCheckRunWebhookDto =
  z.infer<
    typeof githubCheckRunWebhookSchema
  >;

export type GitHubWebhookReceiptDto =
  z.infer<
    typeof githubWebhookReceiptSchema
  >;

export function parseGitHubWorkflowRunWebhook(
  input: unknown,
): GitHubWorkflowRunWebhookDto {
  return githubWorkflowRunWebhookSchema
    .parse(input);
}

export function parseGitHubPullRequestWebhook(
  input: unknown,
): GitHubPullRequestWebhookDto {
  return githubPullRequestWebhookSchema
    .parse(input);
}

export function parseGitHubCheckRunWebhook(
  input: unknown,
): GitHubCheckRunWebhookDto {
  return githubCheckRunWebhookSchema
    .parse(input);
}

export function parseGitHubWebhookReceipt(
  input: unknown,
): GitHubWebhookReceiptDto {
  return githubWebhookReceiptSchema
    .parse(input);
}
