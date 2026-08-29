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
