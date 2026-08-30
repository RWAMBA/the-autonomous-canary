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

export const githubWebhookReceiptSchema =
  z.discriminatedUnion("event", [
    workflowRunReceiptSchema,
    checkRunReceiptSchema,
  ]);

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
