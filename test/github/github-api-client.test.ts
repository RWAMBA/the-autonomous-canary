import assert from "node:assert/strict";
import {
  generateKeyPairSync,
} from "node:crypto";
import {
  test,
} from "node:test";

import {
  GitHubAppApiClient,
  githubApiBaseUrl,
  githubApiVersion,
  maximumGitHubApiResponseBytes,
} from "../../src/github/github-api-client.js";
import type {
  GitHubAppConfig,
} from "../../src/github/github-app-config.js";
import {
  HttpError,
} from "../../src/middleware/http-error.js";

const headSha =
  "42c3e7abfc89e50027866028a87a216177dcdd89";

const installationToken =
  "unit-test-installation-token-value";

const config: GitHubAppConfig = {
  provider: "APP",
  clientId: "Iv23unit-test-client",
  privateKey: generateKeyPairSync(
    "rsa",
    {
      modulusLength: 2_048,
    },
  ).privateKey,
  timeoutMs: 10_000,
};

const request = {
  repository: {
    owner: "RWAMBA",
    name: "the-autonomous-canary",
  },
  runId: 33_271_855_575,
  expectedHeadSha: headSha,
} as const;

const installationResponse = {
  id: 901,
  suspended_at: null,
  permissions: {
    actions: "read",
    metadata: "read",
  },
};

const tokenResponse = {
  token: installationToken,
  expires_at:
    "2026-08-29T21:00:00Z",
  permissions: {
    actions: "read",
  },
};

const workflowRunResponse = {
  id: request.runId,
  name: "Continuous Integration",
  status: "completed",
  conclusion: "failure",
  run_attempt: 2,
  head_sha: headSha,
  repository: {
    full_name:
      "RWAMBA/the-autonomous-canary",
  },
};

const workflowJobsResponse = {
  total_count: 2,
  jobs: [
    {
      id: 101,
      run_id: request.runId,
      head_sha: headSha,
      name: "quality",
      status: "completed",
      conclusion: "failure",
      steps: [
        {
          number: 4,
          name: "Test",
          status: "completed",
          conclusion: "failure",
        },
      ],
    },
    {
      id: 102,
      run_id: request.runId,
      head_sha: headSha,
      name: "container",
      status: "completed",
      conclusion: "skipped",
      steps: [],
    },
  ],
};

interface CapturedRequest {
  readonly url: string;
  readonly init:
    RequestInit | undefined;
}

type ResponseResolver = (
  url: string,
  init: RequestInit | undefined,
  index: number,
) => Response;

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "content-type":
          "application/json",
      },
    },
  );
}

function createFetch(
  resolver?: ResponseResolver,
): {
  readonly requests:
    CapturedRequest[];
  readonly implementation:
    typeof fetch;
} {
  const requests:
    CapturedRequest[] = [];

  const implementation:
    typeof fetch = async (
      input,
      init,
    ) => {
      const url = String(input);
      const index = requests.length;

      requests.push({
        url,
        init,
      });

      if (resolver !== undefined) {
        return resolver(
          url,
          init,
          index,
        );
      }

      if (
        url.endsWith(
          "/installation",
        )
      ) {
        return jsonResponse(
          installationResponse,
        );
      }

      if (
        url.endsWith(
          "/access_tokens",
        )
      ) {
        return jsonResponse(
          tokenResponse,
        );
      }

      if (
        url.endsWith(
          `/actions/runs/${request.runId}`,
        )
      ) {
        return jsonResponse(
          workflowRunResponse,
        );
      }

      if (
        url.endsWith(
          `/actions/runs/${request.runId}/attempts/2/jobs?per_page=100`,
        )
      ) {
        return jsonResponse(
          workflowJobsResponse,
        );
      }

      return jsonResponse({}, 404);
    };

  return {
    requests,
    implementation,
  };
}

function assertHttpError(
  error: unknown,
  expectedStatus: number,
  expectedCode: string,
): asserts error is HttpError {
  assert.ok(error instanceof HttpError);
  assert.equal(
    error.statusCode,
    expectedStatus,
  );
  assert.equal(error.code, expectedCode);
}

test("collects exact-attempt GitHub Actions evidence with a repository-scoped read token", async () => {
  const fakeFetch = createFetch();
  const client = new GitHubAppApiClient(
    config,
    {
      fetchImplementation:
        fakeFetch.implementation,
      clock: () =>
        Date.UTC(
          2026,
          7,
          29,
          20,
          0,
          0,
        ),
    },
  );

  const result = await client.collect(
    request,
  );

  assert.deepEqual(result, {
    provider: "GITHUB_ACTIONS",
    workflowName:
      "Continuous Integration",
    runId: request.runId,
    runAttempt: 2,
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
            conclusion: "failure",
          },
        ],
      },
      {
        jobId: 102,
        name: "container",
        conclusion: "skipped",
        steps: [],
      },
    ],
  });

  assert.equal(
    fakeFetch.requests.length,
    4,
  );

  const installationRequest =
    fakeFetch.requests[0];
  const tokenRequest =
    fakeFetch.requests[1];
  const runRequest =
    fakeFetch.requests[2];
  const jobsRequest =
    fakeFetch.requests[3];

  assert.ok(installationRequest);
  assert.ok(tokenRequest);
  assert.ok(runRequest);
  assert.ok(jobsRequest);

  assert.equal(
    installationRequest.url,
    `${githubApiBaseUrl}/repos/RWAMBA/the-autonomous-canary/installation`,
  );

  const installationHeaders =
    new Headers(
      installationRequest.init
        ?.headers,
    );

  assert.equal(
    installationHeaders.get(
      "x-github-api-version",
    ),
    githubApiVersion,
  );
  assert.match(
    installationHeaders.get(
      "authorization",
    ) ?? "",
    /^Bearer [^.]+\.[^.]+\.[^.]+$/u,
  );

  assert.equal(
    tokenRequest.url,
    `${githubApiBaseUrl}/app/installations/901/access_tokens`,
  );
  assert.deepEqual(
    JSON.parse(
      String(tokenRequest.init?.body),
    ),
    {
      repositories: [
        "the-autonomous-canary",
      ],
      permissions: {
        actions: "read",
      },
    },
  );

  assert.equal(
    new Headers(
      runRequest.init?.headers,
    ).get("authorization"),
    `Bearer ${installationToken}`,
  );
  assert.equal(
    jobsRequest.url,
    `${githubApiBaseUrl}/repos/RWAMBA/the-autonomous-canary/actions/runs/${request.runId}/attempts/2/jobs?per_page=100`,
  );
  assert.equal(
    JSON.stringify(result).includes(
      installationToken,
    ),
    false,
  );
});

test("reports when the GitHub App is not installed", async () => {
  const fakeFetch = createFetch(
    () => jsonResponse({}, 404),
  );

  let capturedError: unknown;

  try {
    await new GitHubAppApiClient(
      config,
      {
        fetchImplementation:
          fakeFetch.implementation,
      },
    ).collect(request);
  } catch (error) {
    capturedError = error;
  }

  assertHttpError(
    capturedError,
    409,
    "GITHUB_APP_NOT_INSTALLED",
  );
});

test("rejects a suspended GitHub App installation", async () => {
  const fakeFetch = createFetch(
    () => jsonResponse({
      ...installationResponse,
      suspended_at:
        "2026-08-29T20:00:00Z",
    }),
  );

  let capturedError: unknown;

  try {
    await new GitHubAppApiClient(
      config,
      {
        fetchImplementation:
          fakeFetch.implementation,
      },
    ).collect(request);
  } catch (error) {
    capturedError = error;
  }

  assertHttpError(
    capturedError,
    409,
    "GITHUB_APP_INSTALLATION_SUSPENDED",
  );
});

test("requires the app installation itself to use Actions read-only permission", async () => {
  const fakeFetch = createFetch(
    () => jsonResponse({
      ...installationResponse,
      permissions: {
        actions: "write",
      },
    }),
  );

  let capturedError: unknown;

  try {
    await new GitHubAppApiClient(
      config,
      {
        fetchImplementation:
          fakeFetch.implementation,
      },
    ).collect(request);
  } catch (error) {
    capturedError = error;
  }

  assertHttpError(
    capturedError,
    502,
    "GITHUB_PROVIDER_UNAVAILABLE",
  );
});

test("rejects a workflow run for a different head commit before requesting jobs", async () => {
  const fakeFetch = createFetch(
    (url) => {
      if (url.endsWith("/installation")) {
        return jsonResponse(
          installationResponse,
        );
      }

      if (url.endsWith("/access_tokens")) {
        return jsonResponse(tokenResponse);
      }

      return jsonResponse({
        ...workflowRunResponse,
        head_sha:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      });
    },
  );

  let capturedError: unknown;

  try {
    await new GitHubAppApiClient(
      config,
      {
        fetchImplementation:
          fakeFetch.implementation,
      },
    ).collect(request);
  } catch (error) {
    capturedError = error;
  }

  assertHttpError(
    capturedError,
    409,
    "GITHUB_HEAD_SHA_MISMATCH",
  );
  assert.equal(
    fakeFetch.requests.length,
    3,
  );
});

test("rejects a workflow run that has not completed", async () => {
  const fakeFetch = createFetch(
    (url) => {
      if (url.endsWith("/installation")) {
        return jsonResponse(
          installationResponse,
        );
      }

      if (url.endsWith("/access_tokens")) {
        return jsonResponse(tokenResponse);
      }

      return jsonResponse({
        ...workflowRunResponse,
        status: "in_progress",
        conclusion: null,
      });
    },
  );

  let capturedError: unknown;

  try {
    await new GitHubAppApiClient(
      config,
      {
        fetchImplementation:
          fakeFetch.implementation,
      },
    ).collect(request);
  } catch (error) {
    capturedError = error;
  }

  assertHttpError(
    capturedError,
    409,
    "GITHUB_WORKFLOW_RUN_NOT_COMPLETED",
  );
  assert.equal(
    fakeFetch.requests.length,
    3,
  );
});

test("rejects jobs bound to a different workflow run", async () => {
  const fakeFetch = createFetch(
    (url) => {
      if (url.endsWith("/installation")) {
        return jsonResponse(
          installationResponse,
        );
      }

      if (url.endsWith("/access_tokens")) {
        return jsonResponse(tokenResponse);
      }

      if (
        url.endsWith(
          `/actions/runs/${request.runId}`,
        )
      ) {
        return jsonResponse(
          workflowRunResponse,
        );
      }

      const firstJob =
        workflowJobsResponse.jobs[0];

      assert.ok(firstJob);

      return jsonResponse({
        total_count: 1,
        jobs: [
          {
            ...firstJob,
            run_id: request.runId + 1,
          },
        ],
      });
    },
  );

  let capturedError: unknown;

  try {
    await new GitHubAppApiClient(
      config,
      {
        fetchImplementation:
          fakeFetch.implementation,
      },
    ).collect(request);
  } catch (error) {
    capturedError = error;
  }

  assertHttpError(
    capturedError,
    409,
    "GITHUB_JOB_RUN_MISMATCH",
  );
});

test("treats invalid normalized GitHub evidence as a provider failure", async () => {
  const fakeFetch = createFetch(
    (url) => {
      if (url.endsWith("/installation")) {
        return jsonResponse(
          installationResponse,
        );
      }

      if (url.endsWith("/access_tokens")) {
        return jsonResponse(tokenResponse);
      }

      if (
        url.endsWith(
          `/actions/runs/${request.runId}`,
        )
      ) {
        return jsonResponse(
          workflowRunResponse,
        );
      }

      const firstJob =
        workflowJobsResponse.jobs[0];
      const firstStep =
        firstJob?.steps[0];

      assert.ok(firstJob);
      assert.ok(firstStep);

      return jsonResponse({
        total_count: 1,
        jobs: [
          {
            ...firstJob,
            steps: [
              firstStep,
              {
                ...firstStep,
                name:
                  "Duplicate step number",
              },
            ],
          },
        ],
      });
    },
  );

  let capturedError: unknown;

  try {
    await new GitHubAppApiClient(
      config,
      {
        fetchImplementation:
          fakeFetch.implementation,
      },
    ).collect(request);
  } catch (error) {
    capturedError = error;
  }

  assertHttpError(
    capturedError,
    502,
    "GITHUB_PROVIDER_UNAVAILABLE",
  );
  assert.equal(capturedError.expose, false);
});

test("returns a sanitized provider error for invalid GitHub responses", async () => {
  const secretResponseValue =
    "provider-secret-response-value";

  const fakeFetch = createFetch(
    (url) => {
      if (url.endsWith("/installation")) {
        return jsonResponse(
          installationResponse,
        );
      }

      if (url.endsWith("/access_tokens")) {
        return jsonResponse(tokenResponse);
      }

      return jsonResponse(
        {
          error: secretResponseValue,
        },
        500,
      );
    },
  );

  let capturedError: unknown;

  try {
    await new GitHubAppApiClient(
      config,
      {
        fetchImplementation:
          fakeFetch.implementation,
      },
    ).collect(request);
  } catch (error) {
    capturedError = error;
  }

  assertHttpError(
    capturedError,
    502,
    "GITHUB_PROVIDER_UNAVAILABLE",
  );
  assert.equal(capturedError.expose, false);
  assert.equal(
    capturedError.message.includes(
      secretResponseValue,
    ),
    false,
  );
  assert.equal(
    capturedError.message.includes(
      installationToken,
    ),
    false,
  );
});

test("rejects an oversized GitHub API response", async () => {
  const oversizedBody = JSON.stringify({
    padding: "x".repeat(
      maximumGitHubApiResponseBytes,
    ),
  });

  const fakeFetch = createFetch(
    () => new Response(
      oversizedBody,
      {
        status: 200,
      },
    ),
  );

  let capturedError: unknown;

  try {
    await new GitHubAppApiClient(
      config,
      {
        fetchImplementation:
          fakeFetch.implementation,
      },
    ).collect(request);
  } catch (error) {
    capturedError = error;
  }

  assertHttpError(
    capturedError,
    502,
    "GITHUB_PROVIDER_UNAVAILABLE",
  );
});

test("bounds every GitHub API request with a timeout", async () => {
  const timeoutConfig: GitHubAppConfig = {
    ...config,
    timeoutMs: 1,
  };

  const timeoutFetch:
    typeof fetch = (
      _input,
      init,
    ) => new Promise(
      (_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(
            new DOMException(
              "Aborted",
              "AbortError",
            ),
          ),
          {
            once: true,
          },
        );
      },
    );

  let capturedError: unknown;

  try {
    await new GitHubAppApiClient(
      timeoutConfig,
      {
        fetchImplementation:
          timeoutFetch,
      },
    ).collect(request);
  } catch (error) {
    capturedError = error;
  }

  assertHttpError(
    capturedError,
    502,
    "GITHUB_PROVIDER_UNAVAILABLE",
  );
});

test("collects a bounded pull-request change with a repository-scoped read token", async () => {
  const pullRequestNumber = 14;
  const baseSha =
    "f50aeca81783a0240afd70d64d1ee7329c890f91";
  const diff =
    "+export const checkRun = true;";

  const fakeFetch = createFetch(
    (url, init) => {
      if (url.endsWith("/installation")) {
        return jsonResponse(
          installationResponse,
        );
      }

      if (url.endsWith("/access_tokens")) {
        return jsonResponse({
          ...tokenResponse,
          permissions: {
            pull_requests: "read",
          },
        });
      }

      const accept = new Headers(
        init?.headers,
      ).get("accept");

      if (
        accept
        === "application/vnd.github.diff"
      ) {
        return new Response(diff, {
          status: 200,
        });
      }

      return jsonResponse({
        number: pullRequestNumber,
        title:
          "Publish a GitHub Check Run",
        body:
          "Use bounded structured output.",
        base: {
          sha: baseSha,
          repo: {
            full_name:
              "RWAMBA/the-autonomous-canary",
          },
        },
        head: {
          sha: headSha,
        },
      });
    },
  );

  const result = await new GitHubAppApiClient(
    config,
    {
      fetchImplementation:
        fakeFetch.implementation,
    },
  ).collectPullRequestChange({
    repository: request.repository,
    pullRequestNumber,
    expectedHeadSha: headSha,
    expectedInstallationId: 901,
  });

  assert.deepEqual(result, {
    title:
      "Publish a GitHub Check Run",
    description:
      "Use bounded structured output.",
    baseSha,
    headSha,
    diff,
  });

  assert.equal(
    fakeFetch.requests.length,
    4,
  );
  assert.deepEqual(
    JSON.parse(
      String(
        fakeFetch.requests[1]
          ?.init?.body,
      ),
    ),
    {
      repositories: [
        "the-autonomous-canary",
      ],
      permissions: {
        pull_requests: "read",
      },
    },
  );
});

test("publishes only controlled review fields through a Checks write token", async () => {
  const secretModelText =
    "untrusted-model-text-must-not-be-published";
  let checkRunBody: unknown;

  const fakeFetch = createFetch(
    (url, init) => {
      if (url.endsWith("/installation")) {
        return jsonResponse(
          installationResponse,
        );
      }

      if (url.endsWith("/access_tokens")) {
        return jsonResponse({
          ...tokenResponse,
          permissions: {
            checks: "write",
          },
        });
      }

      checkRunBody = JSON.parse(
        String(init?.body),
      );

      return jsonResponse({
        id: 7_001,
        name:
          "CanaryGuard release review",
        head_sha: headSha,
        status: "completed",
        conclusion: "failure",
        external_id:
          `canaryguard:${request.runId}:2`,
      }, 201);
    },
  );

  const publication =
    await new GitHubAppApiClient(
      config,
      {
        fetchImplementation:
          fakeFetch.implementation,
      },
    ).publishCheckRun({
      repository: request.repository,
      expectedInstallationId: 901,
      workflowRunId: request.runId,
      runAttempt: 2,
      headSha,
      review: {
        reviewId:
          "59b6f6d7-b052-4a40-8678-7621b8f44286",
        repository:
          request.repository,
        headSha,
        risk: {
          score: 90,
          level: "CRITICAL",
        },
        summary: secretModelText,
        findings: [
          {
            code: "CI_FAILED",
            source:
              "INTELLIGENCE",
            severity: "CRITICAL",
            title: secretModelText,
            explanation:
              secretModelText,
          },
        ],
        requiredActions: [
          secretModelText,
        ],
        policyOverrides: [
          "CI_FAILED",
        ],
        analysis: {
          provider: "MOCK",
          modelTarget:
            "mock-canaryguard-v1",
          promptVersion:
            "canaryguard-review-v3",
        },
        decision: "BLOCK",
        deployment: {
          strategy: "BLOCKED",
          initialTrafficPercent: 0,
        },
      },
    });

  assert.deepEqual(publication, {
    checkRunId: 7_001,
  });
  assert.deepEqual(
    JSON.parse(
      String(
        fakeFetch.requests[1]
          ?.init?.body,
      ),
    ),
    {
      repositories: [
        "the-autonomous-canary",
      ],
      permissions: {
        checks: "write",
      },
    },
  );
  assert.equal(
    JSON.stringify(checkRunBody).includes(
      secretModelText,
    ),
    false,
  );
  assert.deepEqual(checkRunBody, {
    name:
      "CanaryGuard release review",
    head_sha: headSha,
    details_url:
      `https://github.com/RWAMBA/the-autonomous-canary/actions/runs/${request.runId}/attempts/2`,
    external_id:
      `canaryguard:${request.runId}:2`,
    status: "completed",
    conclusion: "failure",
    output: {
      title: "CanaryGuard: BLOCK",
      summary: [
        "CanaryGuard completed a release review.",
        "",
        "- Review ID: 59b6f6d7-b052-4a40-8678-7621b8f44286",
        "- Decision: BLOCK",
        "- Risk: CRITICAL (90/100)",
        "- Deployment: BLOCKED (0% initial traffic)",
        "- Policy overrides: CI_FAILED",
      ].join("\n"),
    },
  });
});

test("rejects a webhook-bound workflow attempt mismatch before requesting jobs", async () => {
  const fakeFetch = createFetch();
  let capturedError: unknown;

  try {
    await new GitHubAppApiClient(
      config,
      {
        fetchImplementation:
          fakeFetch.implementation,
      },
    ).collect({
      ...request,
      expectedRunAttempt: 1,
      expectedInstallationId: 901,
    });
  } catch (error) {
    capturedError = error;
  }

  assertHttpError(
    capturedError,
    409,
    "GITHUB_RUN_ATTEMPT_MISMATCH",
  );
  assert.equal(
    fakeFetch.requests.length,
    3,
  );
});

test("maps canary and standard release strategies to neutral and successful checks", async () => {
  const conclusions: string[] = [];
  let nextCheckRunId = 8_000;

  const fakeFetch = createFetch(
    (url, init) => {
      if (url.endsWith("/installation")) {
        return jsonResponse(
          installationResponse,
        );
      }

      if (url.endsWith("/access_tokens")) {
        return jsonResponse({
          ...tokenResponse,
          permissions: {
            checks: "write",
          },
        });
      }

      const body = JSON.parse(
        String(init?.body),
      ) as {
        conclusion: string;
        external_id: string;
      };

      conclusions.push(body.conclusion);
      nextCheckRunId += 1;

      return jsonResponse({
        id: nextCheckRunId,
        name:
          "CanaryGuard release review",
        head_sha: headSha,
        status: "completed",
        conclusion: body.conclusion,
        external_id:
          body.external_id,
      }, 201);
    },
  );

  const client = new GitHubAppApiClient(
    config,
    {
      fetchImplementation:
        fakeFetch.implementation,
    },
  );

  const commonReview = {
    reviewId:
      "59b6f6d7-b052-4a40-8678-7621b8f44286",
    repository: request.repository,
    headSha,
    findings: [],
    requiredActions: [],
    policyOverrides: [],
    analysis: {
      provider: "MOCK" as const,
      modelTarget:
        "mock-canaryguard-v1",
      promptVersion:
        "canaryguard-review-v3",
    },
    decision: "CONTINUE" as const,
  };

  await client.publishCheckRun({
    repository: request.repository,
    expectedInstallationId: 901,
    workflowRunId: request.runId,
    runAttempt: 1,
    headSha,
    review: {
      ...commonReview,
      risk: {
        score: 60,
        level: "HIGH",
      },
      summary: "Use a canary.",
      deployment: {
        strategy: "CANARY",
        initialTrafficPercent: 5,
      },
    },
  });

  await client.publishCheckRun({
    repository: request.repository,
    expectedInstallationId: 901,
    workflowRunId: request.runId,
    runAttempt: 2,
    headSha,
    review: {
      ...commonReview,
      risk: {
        score: 20,
        level: "LOW",
      },
      summary:
        "Continue at standard traffic.",
      deployment: {
        strategy: "STANDARD",
        initialTrafficPercent: 100,
      },
    },
  });

  assert.deepEqual(conclusions, [
    "neutral",
    "success",
  ]);
});
