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
  parseGitHubWebhookReceipt,
  parseGitHubWorkflowRunWebhook,
} from "../dto/github-webhook.js";
import type {
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

function parsePayload(
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
): GitHubWebhookReceiptDto {
  const completed =
    payload.action === "completed";

  return parseGitHubWebhookReceipt({
    deliveryId,
    event: "workflow_run",
    status: completed
      ? "ACCEPTED"
      : "IGNORED",
    ...(
      completed
        ? {}
        : {
            reason:
              "WORKFLOW_RUN_NOT_COMPLETED",
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

export class DefaultGitHubWebhookReceiver
implements GitHubWebhookReceiver {
  private readonly config:
    EnabledGitHubWebhookConfig;

  private readonly replayGuard:
    GitHubWebhookReplayGuard;

  private readonly logger:
    GitHubWebhookReceiptLogger;

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

    if (event !== "workflow_run") {
      throw new HttpError({
        statusCode: 422,
        code:
          "UNSUPPORTED_GITHUB_WEBHOOK_EVENT",
        message:
          "Only the workflow_run webhook event is supported.",
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

    const payload = parsePayload(
      delivery.rawBody,
    );

    validateBindings(payload);

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

    const receipt = createReceipt(
      deliveryId,
      payload,
    );

    this.logger.log(receipt);

    return receipt;
  }
}
