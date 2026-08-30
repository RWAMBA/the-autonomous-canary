import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import type {
  IncomingHttpHeaders,
} from "node:http";
import {
  TextDecoder,
} from "node:util";

import {
  githubDeliveryIdPattern,
  parseGitHubCheckRunWebhook,
  parseGitHubWebhookReceipt,
  parseGitHubWorkflowRunWebhook,
} from "../dto/github-webhook.js";
import type {
  GitHubCheckRunWebhookDto,
  GitHubWebhookReceiptDto,
  GitHubWorkflowRunWebhookDto,
} from "../dto/github-webhook.js";
import {
  HttpError,
} from "../middleware/http-error.js";
import type {
  EnabledGitHubWebhookConfig,
} from "./github-webhook-config.js";
import {
  InMemoryGitHubWebhookReplayGuard,
} from "./github-webhook-replay-guard.js";
import type {
  GitHubWorkflowRunTaskDispatcher,
} from "./github-workflow-task.js";
import type {
  GitHubWebhookReplayGuard,
} from "./github-webhook-replay-guard.js";

const signaturePattern =
  /^sha256=([a-f0-9]{64})$/u;

const utf8Decoder = new TextDecoder(
  "utf-8",
  {
    fatal: true,
  },
);

export interface GitHubWebhookDelivery {
  readonly headers:
    IncomingHttpHeaders;
  readonly rawBody: Buffer;
}

export interface GitHubWebhookReceiver {
  receive(
    delivery: GitHubWebhookDelivery,
  ): GitHubWebhookReceiptDto;
}

export interface GitHubWebhookReceiptLogger {
  log(
    receipt: GitHubWebhookReceiptDto,
  ): void;
}

export interface GitHubWebhookReceiverOptions {
  readonly replayGuard?:
    GitHubWebhookReplayGuard;
  readonly logger?:
    GitHubWebhookReceiptLogger;
  readonly workflowRunTaskDispatcher?:
    GitHubWorkflowRunTaskDispatcher;
}

const defaultLogger:
  GitHubWebhookReceiptLogger = {
    log: (receipt) => {
      console.log(JSON.stringify({
        telemetryEvent:
          "canaryguard.github.webhook.received",
        ...receipt,
      }));
    },
};

function readRequiredHeader(
  headers: IncomingHttpHeaders,
  name: string,
): string {
  const value = headers[name];

  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
  ) {
    throw new HttpError({
      statusCode: 422,
      code:
        "INVALID_GITHUB_WEBHOOK_HEADERS",
      message:
        "Required GitHub webhook headers are missing or invalid.",
    });
  }

  return value;
}

function readSignatureHeader(
  headers: IncomingHttpHeaders,
): string {
  const value =
    headers["x-hub-signature-256"];

  if (
    typeof value !== "string"
    || value.length === 0
    || value.trim() !== value
  ) {
    throw new HttpError({
      statusCode: 403,
      code:
        "INVALID_GITHUB_WEBHOOK_SIGNATURE",
      message:
        "The GitHub webhook signature is invalid.",
    });
  }

  return value;
}

function verifySignature(
  config: EnabledGitHubWebhookConfig,
  signature: string,
  rawBody: Buffer,
): void {
  const match =
    signaturePattern.exec(signature);

  if (match === null) {
    throw new HttpError({
      statusCode: 403,
      code:
        "INVALID_GITHUB_WEBHOOK_SIGNATURE",
      message:
        "The GitHub webhook signature is invalid.",
    });
  }

  const receivedDigest = Buffer.from(
    match[1] ?? "",
    "hex",
  );

  const expectedDigest = createHmac(
    "sha256",
    config.secret,
  )
    .update(rawBody)
    .digest();

  if (
    receivedDigest.byteLength
      !== expectedDigest.byteLength
    || !timingSafeEqual(
      receivedDigest,
      expectedDigest,
    )
  ) {
    throw new HttpError({
      statusCode: 403,
      code:
        "INVALID_GITHUB_WEBHOOK_SIGNATURE",
      message:
        "The GitHub webhook signature is invalid.",
    });
  }
}

function parseWorkflowRunPayload(
  rawBody: Buffer,
): GitHubWorkflowRunWebhookDto {
  try {
    const text = utf8Decoder.decode(rawBody);

    return parseGitHubWorkflowRunWebhook(
      JSON.parse(text),
    );
  } catch (error) {
    throw new HttpError({
      statusCode: 422,
      code:
        "INVALID_GITHUB_WEBHOOK_PAYLOAD",
      message:
        "The GitHub webhook payload is invalid.",
      cause: error,
    });
  }
}

function parseCheckRunPayload(
  rawBody: Buffer,
): GitHubCheckRunWebhookDto {
  try {
    const text = utf8Decoder.decode(rawBody);

    return parseGitHubCheckRunWebhook(
      JSON.parse(text),
    );
  } catch (error) {
    throw new HttpError({
      statusCode: 422,
      code:
        "INVALID_GITHUB_WEBHOOK_PAYLOAD",
      message:
        "The GitHub webhook payload is invalid.",
      cause: error,
    });
  }
}

function valuesMatch(
  first: string,
  second: string,
): boolean {
  return first.toLowerCase()
    === second.toLowerCase();
}

function validateBindings(
  payload: GitHubWorkflowRunWebhookDto,
): void {
  const repository =
    payload.repository;

  const workflowRepository =
    payload.workflow_run.repository;

  const expectedFullName =
    `${repository.owner.login}/${repository.name}`;

  if (
    !valuesMatch(
      repository.full_name,
      expectedFullName,
    )
    || workflowRepository.id
      !== repository.id
    || !valuesMatch(
      workflowRepository.full_name,
      repository.full_name,
    )
  ) {
    throw new HttpError({
      statusCode: 409,
      code:
        "GITHUB_WEBHOOK_REPOSITORY_MISMATCH",
      message:
        "The workflow run is not bound to the delivered repository.",
    });
  }

  const headCommit =
    payload.workflow_run.head_commit;

  if (
    headCommit !== undefined
    && headCommit !== null
    && !valuesMatch(
      headCommit.id,
      payload.workflow_run.head_sha,
    )
  ) {
    throw new HttpError({
      statusCode: 409,
      code:
        "GITHUB_WEBHOOK_HEAD_SHA_MISMATCH",
      message:
        "The workflow run head commit does not match its head SHA.",
    });
  }
}

function createReceipt(
  deliveryId: string,
  payload: GitHubWorkflowRunWebhookDto,
  requirePullRequest: boolean,
): GitHubWebhookReceiptDto {
  const completed =
    payload.action === "completed";

  const hasOnePullRequest =
    payload.workflow_run
      .pull_requests.length === 1;

  const accepted =
    completed
    && (
      !requirePullRequest
      || hasOnePullRequest
    );

  return parseGitHubWebhookReceipt({
    deliveryId,
    event: "workflow_run",
    status: accepted
      ? "ACCEPTED"
      : "IGNORED",
    ...(
      accepted
        ? {}
        : {
            reason:
              completed
                ? "WORKFLOW_RUN_PULL_REQUEST_UNAVAILABLE"
                : "WORKFLOW_RUN_NOT_COMPLETED",
          }
    ),
    repository: {
      owner:
        payload.repository.owner.login,
      name:
        payload.repository.name,
    },
    workflowRun: {
      id: payload.workflow_run.id,
      runAttempt:
        payload.workflow_run.run_attempt,
      headSha:
        payload.workflow_run.head_sha,
      conclusion:
        payload.workflow_run.conclusion,
    },
  });
}

function createCheckRunReceipt(
  deliveryId: string,
  payload: GitHubCheckRunWebhookDto,
): GitHubWebhookReceiptDto {
  return parseGitHubWebhookReceipt({
    deliveryId,
    event: "check_run",
    status: "IGNORED",
    reason: "CHECK_RUN_EVENT_IGNORED",
    repository: {
      owner:
        payload.repository.owner.login,
      name: payload.repository.name,
    },
  });
}

export class DefaultGitHubWebhookReceiver
implements GitHubWebhookReceiver {
  private readonly config:
    EnabledGitHubWebhookConfig;

  private readonly replayGuard:
    GitHubWebhookReplayGuard;

  private readonly logger:
    GitHubWebhookReceiptLogger;

  private readonly workflowRunTaskDispatcher:
    GitHubWorkflowRunTaskDispatcher
    | undefined;

  constructor(
    config: EnabledGitHubWebhookConfig,
    options:
      GitHubWebhookReceiverOptions = {},
  ) {
    this.config = config;
    this.replayGuard =
      options.replayGuard
      ?? new InMemoryGitHubWebhookReplayGuard({
        ttlMs: config.replayTtlMs,
        capacity: config.replayCapacity,
      });
    this.logger = options.logger
      ?? defaultLogger;
    this.workflowRunTaskDispatcher =
      options.workflowRunTaskDispatcher;
  }

  receive(
    delivery: GitHubWebhookDelivery,
  ): GitHubWebhookReceiptDto {
    const signature = readSignatureHeader(
      delivery.headers,
    );

    verifySignature(
      this.config,
      signature,
      delivery.rawBody,
    );

    const event = readRequiredHeader(
      delivery.headers,
      "x-github-event",
    );

    const deliveryId = readRequiredHeader(
      delivery.headers,
      "x-github-delivery",
    );

    if (
      event !== "workflow_run"
      && event !== "check_run"
    ) {
      throw new HttpError({
        statusCode: 422,
        code:
          "UNSUPPORTED_GITHUB_WEBHOOK_EVENT",
        message:
          "Only workflow_run and check_run webhook events are supported.",
      });
    }

    if (
      !githubDeliveryIdPattern.test(
        deliveryId,
      )
    ) {
      throw new HttpError({
        statusCode: 422,
        code:
          "INVALID_GITHUB_DELIVERY_ID",
        message:
          "X-GitHub-Delivery must contain a valid GUID.",
      });
    }

    const workflowRunPayload =
      event === "workflow_run"
        ? parseWorkflowRunPayload(
            delivery.rawBody,
          )
        : undefined;

    const checkRunPayload =
      event === "check_run"
        ? parseCheckRunPayload(
            delivery.rawBody,
          )
        : undefined;

    if (workflowRunPayload !== undefined) {
      validateBindings(workflowRunPayload);
    }

    const reservation =
      this.replayGuard.reserve(
        deliveryId,
      );

    if (reservation === "DUPLICATE") {
      throw new HttpError({
        statusCode: 409,
        code:
          "GITHUB_WEBHOOK_DELIVERY_REPLAYED",
        message:
          "The GitHub webhook delivery has already been received.",
      });
    }

    if (
      reservation
      === "CAPACITY_EXCEEDED"
    ) {
      throw new HttpError({
        statusCode: 503,
        code:
          "GITHUB_WEBHOOK_REPLAY_CAPACITY_EXCEEDED",
        message:
          "GitHub webhook replay protection is temporarily at capacity.",
        expose: false,
      });
    }

    let receipt: GitHubWebhookReceiptDto;

    try {
      if (workflowRunPayload !== undefined) {
        receipt = createReceipt(
          deliveryId,
          workflowRunPayload,
          this.workflowRunTaskDispatcher
            !== undefined,
        );

        const pullRequest =
          workflowRunPayload.workflow_run
            .pull_requests[0];

        if (
          receipt.status === "ACCEPTED"
          && this.workflowRunTaskDispatcher
            !== undefined
          && pullRequest !== undefined
          && workflowRunPayload
            .workflow_run.conclusion
            !== null
        ) {
          this.workflowRunTaskDispatcher
            .dispatch({
              deliveryId,
              installationId:
                workflowRunPayload
                  .installation.id,
              repository: {
                owner:
                  workflowRunPayload
                    .repository.owner.login,
                name:
                  workflowRunPayload
                    .repository.name,
              },
              workflowRun: {
                id:
                  workflowRunPayload
                    .workflow_run.id,
                runAttempt:
                  workflowRunPayload
                    .workflow_run.run_attempt,
                headSha:
                  workflowRunPayload
                    .workflow_run.head_sha,
                conclusion:
                  workflowRunPayload
                    .workflow_run.conclusion,
              },
              pullRequest: {
                number:
                  pullRequest.number,
              },
            });
        }
      } else if (
        checkRunPayload !== undefined
      ) {
        receipt = createCheckRunReceipt(
          deliveryId,
          checkRunPayload,
        );
      } else {
        throw new Error(
          "GitHub webhook event dispatch failed.",
        );
      }
    } catch (error) {
      this.replayGuard.release(deliveryId);
      throw error;
    }

    this.logger.log(receipt);

    return receipt;
  }
}
