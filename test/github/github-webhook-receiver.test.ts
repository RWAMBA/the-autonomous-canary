import assert from "node:assert/strict";
import {
  createHmac,
  createSecretKey,
} from "node:crypto";
import type {
  IncomingHttpHeaders,
} from "node:http";
import {
  test,
} from "node:test";

import type {
  GitHubWebhookReceiptDto,
} from "../../src/dto/github-webhook.js";
import {
  githubWebhookProviderEnvironmentVariable,
  githubWebhookSecretEnvironmentVariable,
  loadGitHubWebhookConfig,
} from "../../src/github/github-webhook-config.js";
import type {
  GitHubWebhookReplayGuard,
} from "../../src/github/github-webhook-replay-guard.js";
import {
  DefaultGitHubWebhookReceiver,
} from "../../src/github/github-webhook-receiver.js";
import type {
  GitHubWebhookReceiverOptions,
} from "../../src/github/github-webhook-receiver.js";
import {
  HttpError,
} from "../../src/middleware/http-error.js";

const webhookSecret =
  "webhook-test-secret-000000000000";

const defaultDeliveryId =
  "72d3162e-cc78-11e3-81ab-4c9367dc0958";

function createPayload() {
  return {
    action: "completed",
    installation: {
      id: 15_758_562,
    },
    repository: {
      id: 101,
      full_name:
        "RWAMBA/the-autonomous-canary",
      name:
        "the-autonomous-canary",
      owner: {
        login: "RWAMBA",
      },
    },
    workflow_run: {
      id: 33_273_782_416,
      name:
        "Continuous Integration",
      status: "completed",
      conclusion: "success",
      run_attempt: 1,
      head_sha:
        "1ca9fd52769fe3d4e60e02e02d8fe73f1e91f45a",
      head_commit: {
        id:
          "1ca9fd52769fe3d4e60e02e02d8fe73f1e91f45a",
      },
      repository: {
        id: 101,
        full_name:
          "RWAMBA/the-autonomous-canary",
        name:
          "the-autonomous-canary",
        owner: {
          login: "RWAMBA",
        },
      },
      pull_requests: [] as Array<{
        number: number;
      }>,
    },
    sender: {
      login: "octocat",
    },
  };
}

function createReceiver(
  options:
    GitHubWebhookReceiverOptions = {},
): DefaultGitHubWebhookReceiver {
  const config =
    loadGitHubWebhookConfig({
      [githubWebhookProviderEnvironmentVariable]:
        "GITHUB",
      [githubWebhookSecretEnvironmentVariable]:
        webhookSecret,
    });

  if (config.provider !== "GITHUB") {
    assert.fail(
      "Expected enabled webhook configuration.",
    );
  }

  return new DefaultGitHubWebhookReceiver(
    config,
    {
      logger: {
        log: () => undefined,
      },
      ...options,
    },
  );
}

function createDelivery(
  payload: unknown,
  overrides: {
    readonly headers?:
      IncomingHttpHeaders;
    readonly deliveryId?: string;
    readonly event?: string;
    readonly rawBody?: Buffer;
    readonly signature?: string;
  } = {},
) {
  const rawBody = overrides.rawBody
    ?? Buffer.from(
      JSON.stringify(payload),
      "utf8",
    );

  const signature =
    overrides.signature
    ?? `sha256=${createHmac(
      "sha256",
      webhookSecret,
    )
      .update(rawBody)
      .digest("hex")}`;

  return {
    headers: {
      "x-github-event":
        overrides.event
        ?? "workflow_run",
      "x-github-delivery":
        overrides.deliveryId
        ?? defaultDeliveryId,
      "x-hub-signature-256":
        signature,
      ...overrides.headers,
    },
    rawBody,
  };
}

function assertExpectedHttpError(
  error: unknown,
  statusCode: number,
  code: string,
): boolean {
  assert.ok(error instanceof HttpError);
  assert.equal(
    error.statusCode,
    statusCode,
  );
  assert.equal(error.code, code);

  return true;
}

test("accepts a signed completed workflow_run delivery", () => {
  const receipts:
    GitHubWebhookReceiptDto[] = [];

  const receiver = createReceiver({
    logger: {
      log: (receipt) => {
        receipts.push(receipt);
      },
    },
  });

  const receipt = receiver.receive(
    createDelivery(createPayload()),
  );

  assert.deepEqual(receipt, {
    deliveryId: defaultDeliveryId,
    event: "workflow_run",
    status: "ACCEPTED",
    repository: {
      owner: "RWAMBA",
      name:
        "the-autonomous-canary",
    },
    workflowRun: {
      id: 33_273_782_416,
      runAttempt: 1,
      headSha:
        "1ca9fd52769fe3d4e60e02e02d8fe73f1e91f45a",
      conclusion: "success",
    },
  });

  assert.deepEqual(receipts, [
    receipt,
  ]);
  assert.equal(
    JSON.stringify(receipt).includes(
      "sender",
    ),
    false,
  );
});

test("ignores a valid signed workflow_run delivery until it is completed", () => {
  const payload = createPayload();
  payload.action = "in_progress";
  payload.workflow_run.status =
    "in_progress";
  payload.workflow_run.conclusion =
    null as unknown as string;

  const receipt = createReceiver()
    .receive(
      createDelivery(payload),
    );

  assert.equal(receipt.status, "IGNORED");
  assert.equal(
    receipt.reason,
    "WORKFLOW_RUN_NOT_COMPLETED",
  );
  assert.equal(
    receipt.workflowRun.conclusion,
    null,
  );
});

test("verifies the signature before parsing untrusted JSON", () => {
  const rawBody = Buffer.from(
    "{not-json",
    "utf8",
  );

  assert.throws(
    () => createReceiver().receive(
      createDelivery(
        {},
        {
          rawBody,
          signature:
            `sha256=${"0".repeat(64)}`,
        },
      ),
    ),
    (error: unknown) =>
      assertExpectedHttpError(
        error,
        403,
        "INVALID_GITHUB_WEBHOOK_SIGNATURE",
      ),
  );

  assert.throws(
    () => createReceiver().receive(
      createDelivery(
        {},
        {
          rawBody,
        },
      ),
    ),
    (error: unknown) =>
      assertExpectedHttpError(
        error,
        422,
        "INVALID_GITHUB_WEBHOOK_PAYLOAD",
      ),
  );
});

test("matches GitHub's published HMAC-SHA256 test vector", () => {
  const receiver =
    new DefaultGitHubWebhookReceiver(
      {
        provider: "GITHUB",
        secret: createSecretKey(
          Buffer.from(
            "It's a Secret to Everybody",
            "utf8",
          ),
        ),
        replayTtlMs: 60_000,
        replayCapacity: 100,
      },
      {
        logger: {
          log: () => undefined,
        },
      },
    );

  assert.throws(
    () => receiver.receive({
      headers: {
        "x-github-event":
          "workflow_run",
        "x-github-delivery":
          defaultDeliveryId,
        "x-hub-signature-256":
          "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
      },
      rawBody: Buffer.from(
        "Hello, World!",
        "utf8",
      ),
    }),
    (error: unknown) =>
      assertExpectedHttpError(
        error,
        422,
        "INVALID_GITHUB_WEBHOOK_PAYLOAD",
      ),
  );
});

test("rejects missing duplicated and malformed signature headers", () => {
  const invalidHeaders = [
    {
      "x-hub-signature-256":
        undefined,
    },
    {
      "x-hub-signature-256": [
        "sha256=duplicate",
        "sha256=duplicate",
      ],
    },
  ];

  for (const headers of invalidHeaders) {
    assert.throws(
      () => createReceiver().receive(
        createDelivery(
          createPayload(),
          {
            headers,
          },
        ),
      ),
      (error: unknown) =>
        assertExpectedHttpError(
          error,
          403,
          "INVALID_GITHUB_WEBHOOK_SIGNATURE",
        ),
    );
  }

  assert.throws(
    () => createReceiver().receive(
      createDelivery(
        createPayload(),
        {
          signature: "sha1=legacy",
        },
      ),
    ),
    (error: unknown) =>
      assertExpectedHttpError(
        error,
        403,
        "INVALID_GITHUB_WEBHOOK_SIGNATURE",
      ),
  );
});

test("rejects signed unsupported events and invalid delivery identifiers", () => {
  assert.throws(
    () => createReceiver().receive(
      createDelivery(
        createPayload(),
        {
          event: "push",
        },
      ),
    ),
    (error: unknown) =>
      assertExpectedHttpError(
        error,
        422,
        "UNSUPPORTED_GITHUB_WEBHOOK_EVENT",
      ),
  );

  assert.throws(
    () => createReceiver().receive(
      createDelivery(
        createPayload(),
        {
          deliveryId:
            "not-a-guid",
        },
      ),
    ),
    (error: unknown) =>
      assertExpectedHttpError(
        error,
        422,
        "INVALID_GITHUB_DELIVERY_ID",
      ),
  );
});

test("rejects repository identity mismatches", () => {
  const mismatchedPayloads = [
    (() => {
      const payload = createPayload();
      payload.repository.full_name =
        "RWAMBA/another-repository";
      return payload;
    })(),
    (() => {
      const payload = createPayload();
      payload.workflow_run.repository.id =
        202;
      return payload;
    })(),
    (() => {
      const payload = createPayload();
      payload.workflow_run.repository.full_name =
        "RWAMBA/another-repository";
      return payload;
    })(),
  ];

  for (const payload of mismatchedPayloads) {
    assert.throws(
      () => createReceiver().receive(
        createDelivery(payload),
      ),
      (error: unknown) =>
        assertExpectedHttpError(
          error,
          409,
          "GITHUB_WEBHOOK_REPOSITORY_MISMATCH",
        ),
    );
  }
});

test("rejects a head commit that is not bound to the workflow head SHA", () => {
  const payload = createPayload();
  payload.workflow_run.head_commit.id =
    "42c3e7abfc89e50027866028a87a216177dcdd89";

  assert.throws(
    () => createReceiver().receive(
      createDelivery(payload),
    ),
    (error: unknown) =>
      assertExpectedHttpError(
        error,
        409,
        "GITHUB_WEBHOOK_HEAD_SHA_MISMATCH",
      ),
  );
});

test("rejects a delivery replay without logging it twice", () => {
  let logCalls = 0;

  const receiver = createReceiver({
    logger: {
      log: () => {
        logCalls += 1;
      },
    },
  });

  const delivery =
    createDelivery(createPayload());

  receiver.receive(delivery);

  assert.throws(
    () => receiver.receive(delivery),
    (error: unknown) =>
      assertExpectedHttpError(
        error,
        409,
        "GITHUB_WEBHOOK_DELIVERY_REPLAYED",
      ),
  );

  assert.equal(logCalls, 1);
});

test("returns a hidden server error when replay protection is at capacity", () => {
  const replayGuard:
    GitHubWebhookReplayGuard = {
      reserve: () =>
        "CAPACITY_EXCEEDED",
      release: () => {},
    };

  assert.throws(
    () => createReceiver({
      replayGuard,
    }).receive(
      createDelivery(createPayload()),
    ),
    (error: unknown) => {
      assertExpectedHttpError(
        error,
        503,
        "GITHUB_WEBHOOK_REPLAY_CAPACITY_EXCEEDED",
      );
      assert.ok(error instanceof HttpError);
      assert.equal(error.expose, false);

      return true;
    },
  );
});

test("dispatches one completed pull-request workflow after signature and binding validation", () => {
  const tasks: unknown[] = [];
  const payload = createPayload();

  payload.workflow_run.pull_requests = [
    {
      number: 14,
    },
  ];

  const receipt = createReceiver({
    workflowRunTaskDispatcher: {
      dispatch: (task) => {
        tasks.push(task);
      },
    },
  }).receive(createDelivery(payload));

  assert.equal(receipt.status, "ACCEPTED");
  assert.deepEqual(tasks, [
    {
      deliveryId: defaultDeliveryId,
      installationId: 15_758_562,
      repository: {
        owner: "RWAMBA",
        name:
          "the-autonomous-canary",
      },
      workflowRun: {
        id: 33_273_782_416,
        runAttempt: 1,
        headSha:
          "1ca9fd52769fe3d4e60e02e02d8fe73f1e91f45a",
        conclusion: "success",
      },
      pullRequest: {
        number: 14,
      },
    },
  ]);
});

test("does not automate a completed workflow without exactly one pull request", () => {
  let dispatchCalls = 0;

  const receipt = createReceiver({
    workflowRunTaskDispatcher: {
      dispatch: () => {
        dispatchCalls += 1;
      },
    },
  }).receive(
    createDelivery(createPayload()),
  );

  assert.deepEqual(receipt, {
    deliveryId: defaultDeliveryId,
    event: "workflow_run",
    status: "IGNORED",
    reason:
      "WORKFLOW_RUN_PULL_REQUEST_UNAVAILABLE",
    repository: {
      owner: "RWAMBA",
      name:
        "the-autonomous-canary",
    },
    workflowRun: {
      id: 33_273_782_416,
      runAttempt: 1,
      headSha:
        "1ca9fd52769fe3d4e60e02e02d8fe73f1e91f45a",
      conclusion: "success",
    },
  });
  assert.equal(dispatchCalls, 0);
});

test("releases replay reservation when bounded task dispatch rejects the delivery", () => {
  const released: string[] = [];
  const replayGuard:
    GitHubWebhookReplayGuard = {
      reserve: () => "ACCEPTED",
      release: (deliveryId) => {
        released.push(deliveryId);
      },
    };
  const payload = createPayload();

  payload.workflow_run.pull_requests = [
    {
      number: 14,
    },
  ];

  assert.throws(
    () => createReceiver({
      replayGuard,
      workflowRunTaskDispatcher: {
        dispatch: () => {
          throw new HttpError({
            statusCode: 503,
            code:
              "GITHUB_AUTOMATION_QUEUE_CAPACITY_EXCEEDED",
            message:
              "The queue is full.",
            expose: false,
          });
        },
      },
    }).receive(createDelivery(payload)),
    (error: unknown) =>
      assertExpectedHttpError(
        error,
        503,
        "GITHUB_AUTOMATION_QUEUE_CAPACITY_EXCEEDED",
      ),
  );

  assert.deepEqual(released, [
    defaultDeliveryId,
  ]);
});

test("acknowledges generated check_run traffic without creating an automation loop", () => {
  const receipt = createReceiver()
    .receive(createDelivery(
      {
        action: "completed",
        repository: {
          id: 101,
          full_name:
            "RWAMBA/the-autonomous-canary",
          name:
            "the-autonomous-canary",
          owner: {
            login: "RWAMBA",
          },
        },
        check_run: {
          id: 7_001,
          output: {
            text:
              "untrusted ignored data",
          },
        },
      },
      {
        event: "check_run",
      },
    ));

  assert.deepEqual(receipt, {
    deliveryId: defaultDeliveryId,
    event: "check_run",
    status: "IGNORED",
    reason:
      "CHECK_RUN_EVENT_IGNORED",
    repository: {
      owner: "RWAMBA",
      name:
        "the-autonomous-canary",
    },
  });
  assert.equal(
    JSON.stringify(receipt).includes(
      "untrusted ignored data",
    ),
    false,
  );
});
