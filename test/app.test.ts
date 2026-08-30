import assert from "node:assert/strict";
import {
  createHmac,
} from "node:crypto";
import {
  createServer,
} from "node:http";
import {
  after,
  before,
  test,
} from "node:test";

import {
  createRequestHandler,
} from "../src/app.js";
import {
  DefaultReviewController,
} from "../src/controllers/review-controller.js";
import {
  DefaultGitHubReviewController,
} from "../src/controllers/github-review-controller.js";
import {
  parseCiEvidence,
} from "../src/dto/ci-evidence.js";
import {
  parseGitHubWebhookReceipt,
} from "../src/dto/github-webhook.js";
import {
  parseReviewResponse,
} from "../src/dto/review-response.js";
import {
  createFailureSimulator,
} from "../src/failure-simulator.js";
import {
  githubWebhookProviderEnvironmentVariable,
  githubWebhookSecretEnvironmentVariable,
  loadGitHubWebhookConfig,
} from "../src/github/github-webhook-config.js";
import {
  DefaultGitHubWebhookReceiver,
} from "../src/github/github-webhook-receiver.js";
import {
  maximumJsonBodyBytes,
} from "../src/middleware/read-json-body.js";
import {
  createReviewApiKeyAuthenticator,
} from "../src/middleware/require-review-api-key.js";

const reviewApiKey =
  "r".repeat(32);

const reviewId =
  "123e4567-e89b-42d3-a456-426614174000";

const githubWebhookSecret =
  "application-webhook-test-secret-000000";

function createReviewRequest(
  testStatus:
    | "passed"
    | "failed" = "passed",
) {
  return {
    repository: {
      owner: "RWAMBA",
      name: "the-autonomous-canary",
    },
    change: {
      title:
        "Add the CanaryGuard review API",
      description:
        "Introduces structured release-risk analysis.",
      baseSha:
        "abcdef1234567890",
      headSha:
        "1234567890abcdef",
      diff:
        "+export const reviewEnabled = true;",
    },
    evidence: {
      testStatus,
      securityFindings: [],
    },
  };
}

const reviewController =
  new DefaultReviewController({
    createReviewId:
      () => reviewId,
    telemetryLogger: {
      log: () => undefined,
    },
  });

let githubCollectionCalls = 0;

const githubReviewController =
  new DefaultGitHubReviewController({
    evidenceCollector: {
      collect: (request) => {
        githubCollectionCalls += 1;

        return Promise.resolve(
          parseCiEvidence({
            provider:
              "GITHUB_ACTIONS",
            workflowName:
              "Continuous Integration",
            runId: request.runId,
            runAttempt: 1,
            conclusion: "failure",
            jobs: [
              {
                jobId: 101,
                name: "quality",
                conclusion: "failure",
                steps: [
                  {
                    number: 4,
                    name: "Test",
                    conclusion:
                      "failure",
                  },
                ],
              },
            ],
          }),
        );
      },
    },
    reviewController,
  });

function createGitHubWebhookReceiver() {
  const config = loadGitHubWebhookConfig({
    [githubWebhookProviderEnvironmentVariable]:
      "GITHUB",
    [githubWebhookSecretEnvironmentVariable]:
      githubWebhookSecret,
  });

  if (config.provider !== "GITHUB") {
    throw new Error(
      "Expected enabled webhook configuration.",
    );
  }

  return new DefaultGitHubWebhookReceiver(
    config,
    {
      logger: {
        log: () => undefined,
      },
    },
  );
}

function createGitHubWebhookPayload(
  action:
    | "completed"
    | "in_progress" = "completed",
) {
  const completed =
    action === "completed";

  return {
    action,
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
      status: completed
        ? "completed"
        : "in_progress",
      conclusion: completed
        ? "success"
        : null,
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
    },
  };
}

function signGitHubWebhookBody(
  body: string,
): string {
  return `sha256=${createHmac(
    "sha256",
    githubWebhookSecret,
  )
    .update(body)
    .digest("hex")}`;
}

const server = createServer(
  createRequestHandler(
    {
      channel: "canary",
      commitSha: "abc123",
      version: "1.2.3",
    },
    createFailureSimulator(2),
    {
      reviewController,
      githubReviewController,
      githubWebhookReceiver:
        createGitHubWebhookReceiver(),
      authenticateReviewRequest:
        createReviewApiKeyAuthenticator(
          reviewApiKey,
        ),
    },
  ),
);

let baseUrl = "";

before(async () => {
  await new Promise<void>(
    (resolve, reject) => {
      server.once(
        "error",
        reject,
      );

      server.listen(
        0,
        "127.0.0.1",
        () => {
          server.off(
            "error",
            reject,
          );

          resolve();
        },
      );
    },
  );

  const address =
    server.address();

  if (
    address === null
    || typeof address === "string"
  ) {
    throw new Error(
      "Expected the test server to use a TCP port.",
    );
  }

  baseUrl =
    `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>(
    (resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        resolve();
      });
    },
  );
});

test("GET /health returns the service health", async () => {
  const response =
    await fetch(
      `${baseUrl}/health`,
    );

  assert.equal(
    response.status,
    200,
  );

  assert.deepEqual(
    await response.json(),
    {
      service:
        "the-autonomous-canary",
      status: "ok",
    },
  );
});

test("GET /version returns the release identity", async () => {
  const response =
    await fetch(
      `${baseUrl}/version`,
    );

  assert.equal(
    response.status,
    200,
  );

  assert.deepEqual(
    await response.json(),
    {
      service:
        "the-autonomous-canary",
      release: {
        channel: "canary",
        commitSha: "abc123",
        version: "1.2.3",
      },
    },
  );
});

test("GET /work exposes deterministic workload outcomes", async () => {
  const successfulResponse =
    await fetch(
      `${baseUrl}/work`,
    );

  assert.equal(
    successfulResponse.status,
    200,
  );

  assert.deepEqual(
    await successfulResponse.json(),
    {
      service:
        "the-autonomous-canary",
      release: {
        channel: "canary",
        commitSha: "abc123",
        version: "1.2.3",
      },
      result: "ok",
    },
  );

  const failedResponse =
    await fetch(
      `${baseUrl}/work`,
    );

  assert.equal(
    failedResponse.status,
    503,
  );

  assert.deepEqual(
    await failedResponse.json(),
    {
      service:
        "the-autonomous-canary",
      release: {
        channel: "canary",
        commitSha: "abc123",
        version: "1.2.3",
      },
      error:
        "Simulated workload failure",
    },
  );

  const healthResponse =
    await fetch(
      `${baseUrl}/health`,
    );

  assert.equal(
    healthResponse.status,
    200,
  );
});

test("POST /reviews processes a valid release review", async () => {
  const response =
    await fetch(
      `${baseUrl}/reviews`,
      {
        method: "POST",
        headers: {
          authorization:
            `Bearer ${reviewApiKey}`,
          "content-type":
            "application/json",
        },
        body: JSON.stringify(
          createReviewRequest(),
        ),
      },
    );

  assert.equal(
    response.status,
    201,
  );

  assert.equal(
    response.headers.get(
      "cache-control",
    ),
    "no-store",
  );

  const review =
    parseReviewResponse(
      await response.json(),
    );

  assert.equal(
    review.reviewId,
    reviewId,
  );

  assert.equal(
    review.headSha,
    "1234567890abcdef",
  );

  assert.equal(
    review.decision,
    "CONTINUE",
  );

  assert.deepEqual(
    review.risk,
    {
      score: 20,
      level: "LOW",
    },
  );

  assert.deepEqual(
    review.deployment,
    {
      strategy: "STANDARD",
      initialTrafficPercent: 100,
    },
  );

  assert.deepEqual(
    review.policyOverrides,
    [],
  );

  assert.deepEqual(
    review.analysis,
    {
      provider: "MOCK",
      modelTarget:
        "mock-canaryguard-v1",
      promptVersion:
        "canaryguard-review-v3",
    },
  );
});

test("POST /reviews blocks failed tests despite mock AI continuation", async () => {
  const response =
    await fetch(
      `${baseUrl}/reviews`,
      {
        method: "POST",
        headers: {
          authorization:
            `Bearer ${reviewApiKey}`,
          "content-type":
            "application/json",
        },
        body: JSON.stringify(
          createReviewRequest(
            "failed",
          ),
        ),
      },
    );

  assert.equal(
    response.status,
    201,
  );

  const review =
    parseReviewResponse(
      await response.json(),
    );

  assert.equal(
    review.decision,
    "BLOCK",
  );

  assert.deepEqual(
    review.deployment,
    {
      strategy: "BLOCKED",
      initialTrafficPercent: 0,
    },
  );

  assert.ok(
    review.policyOverrides.includes(
      "TESTS_FAILED",
    ),
  );

  assert.ok(
    review.findings.some(
      (finding) =>
        finding.code
          === "TESTS_FAILED",
    ),
  );
});

test("POST /reviews investigates GitHub Actions failures without exposing logs", async () => {
  const request = createReviewRequest();
  const fakeGitHubToken =
    "ghp_abcdefghijklmnopqrstuvwxyz1234567890";

  const response =
    await fetch(
      `${baseUrl}/reviews`,
      {
        method: "POST",
        headers: {
          authorization:
            `Bearer ${reviewApiKey}`,
          "content-type":
            "application/json",
        },
        body: JSON.stringify({
          ...request,
          evidence: {
            ...request.evidence,
            ci: {
              provider:
                "GITHUB_ACTIONS",
              workflowName:
                "Continuous Integration",
              runId: 33_262_408_116,
              runAttempt: 1,
              conclusion: "failure",
              jobs: [
                {
                  jobId: 101,
                  name: "quality",
                  conclusion: "failure",
                  steps: [
                    {
                      number: 4,
                      name: "Test",
                      conclusion:
                        "failure",
                      logExcerpt:
                        `token=${fakeGitHubToken}`,
                    },
                  ],
                },
              ],
            },
          },
        }),
      },
    );

  assert.equal(
    response.status,
    201,
  );

  const review =
    parseReviewResponse(
      await response.json(),
    );

  assert.equal(
    review.decision,
    "BLOCK",
  );
  assert.deepEqual(
    review.policyOverrides,
    [
      "CI_FAILED",
    ],
  );
  assert.equal(
    review.ciInvestigation?.outcome,
    "FAILED",
  );
  assert.equal(
    JSON.stringify(review).includes(
      fakeGitHubToken,
    ),
    false,
  );
  assert.equal(
    JSON.stringify(review).includes(
      "logExcerpt",
    ),
    false,
  );
});

test("POST /github/reviews collects authoritative GitHub evidence", async () => {
  const request = createReviewRequest();

  const response = await fetch(
    `${baseUrl}/github/reviews`,
    {
      method: "POST",
      headers: {
        authorization:
          `Bearer ${reviewApiKey}`,
        "content-type":
          "application/json",
      },
      body: JSON.stringify({
        ...request,
        github: {
          runId: 33_271_855_575,
        },
      }),
    },
  );

  assert.equal(response.status, 201);
  assert.equal(
    response.headers.get(
      "cache-control",
    ),
    "no-store",
  );

  const review = parseReviewResponse(
    await response.json(),
  );

  assert.equal(
    review.ciInvestigation?.runId,
    33_271_855_575,
  );
  assert.equal(
    review.ciInvestigation?.outcome,
    "FAILED",
  );
  assert.deepEqual(
    review.policyOverrides,
    [
      "CI_FAILED",
    ],
  );
  assert.equal(review.decision, "BLOCK");
  assert.equal(
    JSON.stringify(review).includes(
      "logExcerpt",
    ),
    false,
  );
});

test("POST /github/reviews authenticates before GitHub collection", async () => {
  const callsBefore =
    githubCollectionCalls;

  const response = await fetch(
    `${baseUrl}/github/reviews`,
    {
      method: "POST",
      headers: {
        "content-type":
          "application/json",
      },
      body: JSON.stringify({
        ...createReviewRequest(),
        github: {
          runId: 33_271_855_575,
        },
      }),
    },
  );

  assert.equal(response.status, 401);
  assert.equal(
    githubCollectionCalls,
    callsBefore,
  );
});

test("GET /github/reviews returns method not allowed", async () => {
  const response = await fetch(
    `${baseUrl}/github/reviews`,
  );

  assert.equal(response.status, 405);
  assert.equal(
    response.headers.get("allow"),
    "POST",
  );
});

test("POST /github/reviews is unavailable when GitHub App collection is disabled", async () => {
  const disabledServer = createServer(
    createRequestHandler(
      {
        channel: "local",
        commitSha: "abc123",
        version: "1.2.3",
      },
      createFailureSimulator(0),
      {
        reviewController,
        authenticateReviewRequest:
          createReviewApiKeyAuthenticator(
            reviewApiKey,
          ),
      },
    ),
  );

  await new Promise<void>(
    (resolve, reject) => {
      disabledServer.once(
        "error",
        reject,
      );
      disabledServer.listen(
        0,
        "127.0.0.1",
        () => {
          disabledServer.off(
            "error",
            reject,
          );
          resolve();
        },
      );
    },
  );

  try {
    const address =
      disabledServer.address();

    assert.ok(
      address !== null
      && typeof address !== "string",
    );

    const response = await fetch(
      `http://127.0.0.1:${address.port}/github/reviews`,
      {
        method: "POST",
        headers: {
          authorization:
            `Bearer ${reviewApiKey}`,
          "content-type":
            "application/json",
        },
        body: "{}",
      },
    );

    assert.equal(response.status, 503);
    assert.deepEqual(
      await response.json(),
      {
        error: {
          code:
            "INTERNAL_SERVER_ERROR",
          message:
            "An unexpected server error occurred.",
        },
      },
    );
  } finally {
    await new Promise<void>(
      (resolve, reject) => {
        disabledServer.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }

          resolve();
        });
      },
    );
  }
});

test("POST /github/webhooks accepts a signed completed workflow_run without bearer authentication", async () => {
  const body = JSON.stringify(
    createGitHubWebhookPayload(),
  );

  const response = await fetch(
    `${baseUrl}/github/webhooks`,
    {
      method: "POST",
      headers: {
        "content-type":
          "application/json",
        "x-github-event":
          "workflow_run",
        "x-github-delivery":
          "11111111-2222-3333-4444-555555555555",
        "x-hub-signature-256":
          signGitHubWebhookBody(body),
      },
      body,
    },
  );

  assert.equal(response.status, 202);
  assert.equal(
    response.headers.get(
      "cache-control",
    ),
    "no-store",
  );

  const receipt =
    parseGitHubWebhookReceipt(
      await response.json(),
    );

  assert.equal(
    receipt.status,
    "ACCEPTED",
  );

  assert.equal(
    receipt.event,
    "workflow_run",
  );

  if (receipt.event !== "workflow_run") {
    assert.fail(
      "Expected a workflow_run receipt.",
    );
  }

  assert.equal(
    receipt.workflowRun.id,
    33_273_782_416,
  );
});

test("POST /github/webhooks acknowledges and ignores a signed noncompleted run", async () => {
  const body = JSON.stringify(
    createGitHubWebhookPayload(
      "in_progress",
    ),
  );

  const response = await fetch(
    `${baseUrl}/github/webhooks`,
    {
      method: "POST",
      headers: {
        "content-type":
          "application/json",
        "x-github-event":
          "workflow_run",
        "x-github-delivery":
          "22222222-3333-4444-5555-666666666666",
        "x-hub-signature-256":
          signGitHubWebhookBody(body),
      },
      body,
    },
  );

  assert.equal(response.status, 202);

  const receipt =
    parseGitHubWebhookReceipt(
      await response.json(),
    );

  assert.equal(
    receipt.status,
    "IGNORED",
  );
  assert.equal(
    receipt.reason,
    "WORKFLOW_RUN_NOT_COMPLETED",
  );
});

test("POST /github/webhooks rejects an invalid signature without a bearer challenge", async () => {
  const response = await fetch(
    `${baseUrl}/github/webhooks`,
    {
      method: "POST",
      headers: {
        "content-type":
          "application/json",
        "x-github-event":
          "workflow_run",
        "x-github-delivery":
          "33333333-4444-5555-6666-777777777777",
        "x-hub-signature-256":
          `sha256=${"0".repeat(64)}`,
      },
      body: JSON.stringify(
        createGitHubWebhookPayload(),
      ),
    },
  );

  assert.equal(response.status, 403);
  assert.equal(
    response.headers.get(
      "www-authenticate",
    ),
    null,
  );
  assert.deepEqual(
    await response.json(),
    {
      error: {
        code:
          "INVALID_GITHUB_WEBHOOK_SIGNATURE",
        message:
          "The GitHub webhook signature is invalid.",
      },
    },
  );
});

test("GET /github/webhooks returns method not allowed", async () => {
  const response = await fetch(
    `${baseUrl}/github/webhooks`,
  );

  assert.equal(response.status, 405);
  assert.equal(
    response.headers.get("allow"),
    "POST",
  );
});

test("POST /github/webhooks is unavailable when webhook ingestion is disabled", async () => {
  const disabledServer = createServer(
    createRequestHandler(
      {
        channel: "local",
        commitSha: "abc123",
        version: "1.2.3",
      },
      createFailureSimulator(0),
      {
        reviewController,
        authenticateReviewRequest:
          createReviewApiKeyAuthenticator(
            reviewApiKey,
          ),
      },
    ),
  );

  await new Promise<void>(
    (resolve, reject) => {
      disabledServer.once(
        "error",
        reject,
      );
      disabledServer.listen(
        0,
        "127.0.0.1",
        () => {
          disabledServer.off(
            "error",
            reject,
          );
          resolve();
        },
      );
    },
  );

  try {
    const address =
      disabledServer.address();

    assert.ok(
      address !== null
      && typeof address !== "string",
    );

    const response = await fetch(
      `http://127.0.0.1:${address.port}/github/webhooks`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
        },
        body: "{}",
      },
    );

    assert.equal(response.status, 503);
    assert.deepEqual(
      await response.json(),
      {
        error: {
          code:
            "INTERNAL_SERVER_ERROR",
          message:
            "An unexpected server error occurred.",
        },
      },
    );
  } finally {
    await new Promise<void>(
      (resolve, reject) => {
        disabledServer.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }

          resolve();
        });
      },
    );
  }
});

test("POST /reviews rejects missing authentication", async () => {
  const response =
    await fetch(
      `${baseUrl}/reviews`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
        },
        body: JSON.stringify(
          createReviewRequest(),
        ),
      },
    );

  assert.equal(
    response.status,
    401,
  );

  assert.equal(
    response.headers.get(
      "cache-control",
    ),
    "no-store",
  );

  assert.equal(
    response.headers.get(
      "www-authenticate",
    ),
    'Bearer realm="canaryguard-reviews"',
  );

  assert.deepEqual(
    await response.json(),
    {
      error: {
        code: "UNAUTHORIZED",
        message:
          "A valid bearer token is required.",
      },
    },
  );
});

test("POST /reviews rejects malformed JSON", async () => {
  const response =
    await fetch(
      `${baseUrl}/reviews`,
      {
        method: "POST",
        headers: {
          authorization:
            `Bearer ${reviewApiKey}`,
          "content-type":
            "application/json",
        },
        body:
          "{\"incomplete\":",
      },
    );

  assert.equal(
    response.status,
    400,
  );

  assert.deepEqual(
    await response.json(),
    {
      error: {
        code: "INVALID_JSON",
        message:
          "Request body must contain valid JSON.",
      },
    },
  );
});

test("POST /reviews rejects an oversized request body", async () => {
  const oversizedBody =
    "a".repeat(
      maximumJsonBodyBytes + 1,
    );

  const response =
    await fetch(
      `${baseUrl}/reviews`,
      {
        method: "POST",
        headers: {
          authorization:
            `Bearer ${reviewApiKey}`,
          "content-type":
            "application/json",
        },
        body: oversizedBody,
      },
    );

  assert.equal(
    response.status,
    413,
  );

  assert.deepEqual(
    await response.json(),
    {
      error: {
        code:
          "PAYLOAD_TOO_LARGE",
        message:
          `Request body must not exceed ${maximumJsonBodyBytes} bytes.`,
      },
    },
  );
});

test("POST /reviews rejects an invalid review DTO", async () => {
  const response =
    await fetch(
      `${baseUrl}/reviews`,
      {
        method: "POST",
        headers: {
          authorization:
            `Bearer ${reviewApiKey}`,
          "content-type":
            "application/json",
        },
        body: JSON.stringify({}),
      },
    );

  assert.equal(
    response.status,
    400,
  );

  assert.deepEqual(
    await response.json(),
    {
      error: {
        code:
          "VALIDATION_ERROR",
        message:
          "Request payload failed validation.",
        issues: [
          {
            path: "repository",
            code: "invalid_type",
          },
          {
            path: "change",
            code: "invalid_type",
          },
          {
            path: "evidence",
            code: "invalid_type",
          },
        ],
      },
    },
  );
});

test("GET /reviews returns method not allowed", async () => {
  const response =
    await fetch(
      `${baseUrl}/reviews`,
    );

  assert.equal(
    response.status,
    405,
  );

  assert.equal(
    response.headers.get("allow"),
    "POST",
  );

  assert.deepEqual(
    await response.json(),
    {
      error: {
        code:
          "METHOD_NOT_ALLOWED",
        message:
          "Only POST is supported for /reviews.",
      },
    },
  );
});

test("an unknown route returns 404", async () => {
  const response =
    await fetch(
      `${baseUrl}/not-found`,
    );

  assert.equal(
    response.status,
    404,
  );

  assert.deepEqual(
    await response.json(),
    {
      error: "Not Found",
    },
  );
});
