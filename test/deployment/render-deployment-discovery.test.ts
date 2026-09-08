import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  discoverRenderDeploymentCorrelation,
  RenderApiDeploymentDiscovery,
  ManagementApiReleaseDiscovery,
  type RenderDeploymentDiscoveryConfig,
} from "../../src/deployment/render-deployment-discovery.js";

const deployedCommitSha =
  "be147dd651fb58388d2864203d6377df74a828f9";
const reviewHeadSha =
  "3128a8c383889ae107e9a999778be70a2263a21a";
const releaseId =
  "123e4567-e89b-42d3-a456-426614174000";
const attemptId =
  "223e4567-e89b-42d3-a456-426614174000";

const config: RenderDeploymentDiscoveryConfig = {
  managementReleasesUrl:
    "https://canaryguard.example/management/releases",
  apiKey:
    "unit-test-review-api-key-000000000000",
  repository: {
    owner: "RWAMBA",
    name: "the-autonomous-canary",
  },
  deployedCommitSha,
  renderApiKey:
    "rnd_unit_test_render_api_key",
  renderServiceId: "srv-unit-test",
  timeoutMs: 10_000,
};

test("discovers exact Render, GitHub, and release correlation", async () => {
  const result =
    await discoverRenderDeploymentCorrelation(
      config,
      {
        render: {
          discoverLiveDeployment: async () => ({
            deploymentId: "dep-unit-test",
            commitSha: deployedCommitSha,
          }),
        },
        github: {
          discoverMergedPullRequest: async () => ({
            pullRequestNumber: 26,
            headSha: reviewHeadSha,
          }),
        },
        releases: {
          discoverReviewedRelease: async () => ({
            repository: config.repository,
            releaseId,
            headSha: reviewHeadSha,
            pullRequestNumber: 26,
            status: "REVIEWED",
            decision: "CONTINUE",
            deploymentStrategy: "CANARY",
            initialTrafficPercent: 5,
          }),
        },
        createDeploymentAttemptId: () =>
          attemptId,
      },
    );

  assert.deepEqual(result, {
    provider: "RENDER",
    externalDeploymentId: "dep-unit-test",
    deployedCommitSha,
    pullRequestNumber: 26,
    reviewHeadSha,
    releaseId,
    deploymentAttemptId: attemptId,
    deploymentStrategy: "CANARY",
    initialTrafficPercent: 5,
  });
});

test("release discovery uses an exact authenticated head-SHA query", async () => {
  let capturedUrl = "";
  let capturedAuthorization = "";
  const discovery = new ManagementApiReleaseDiscovery({
    fetchImplementation: async (url, init) => {
      capturedUrl = String(url);
      capturedAuthorization =
        new Headers(init?.headers)
          .get("authorization") ?? "";

      return new Response(JSON.stringify({
        repository: config.repository,
        releases: [
          {
            releaseId,
            headSha: reviewHeadSha,
            status: "REVIEWED",
            pullRequest: {
              number: 26,
              state: "CLOSED",
              draft: false,
            },
            policyDecision: {
              decision: "CONTINUE",
              deploymentStrategy: "CANARY",
              initialTrafficPercent: 5,
              policyOverrides: [],
            },
            createdAt:
              "2026-09-08T12:00:00.000Z",
            updatedAt:
              "2026-09-08T12:10:00.000Z",
          },
        ],
      }), {
        status: 200,
      });
    },
  });

  assert.deepEqual(
    await discovery.discoverReviewedRelease({
      managementReleasesUrl:
        config.managementReleasesUrl,
      apiKey: config.apiKey,
      repository: config.repository,
      headSha: reviewHeadSha,
      timeoutMs: 10_000,
    }),
    {
      releaseId,
      headSha: reviewHeadSha,
      repository: config.repository,
      pullRequestNumber: 26,
      status: "REVIEWED",
      decision: "CONTINUE",
      deploymentStrategy: "CANARY",
      initialTrafficPercent: 5,
    },
  );

  const url = new URL(capturedUrl);
  assert.equal(
    url.pathname,
    "/management/releases",
  );
  assert.equal(
    url.searchParams.get("headSha"),
    reviewHeadSha,
  );
  assert.equal(url.searchParams.get("limit"), "2");
  assert.equal(
    capturedAuthorization,
    `Bearer ${config.apiKey}`,
  );
});

test("rejects correlation mismatches before publication", async () => {
  await assert.rejects(
    discoverRenderDeploymentCorrelation(
      config,
      {
        render: {
          discoverLiveDeployment: async () => ({
            deploymentId: "dep-unit-test",
            commitSha: deployedCommitSha,
          }),
        },
        github: {
          discoverMergedPullRequest: async () => ({
            pullRequestNumber: 26,
            headSha: reviewHeadSha,
          }),
        },
        releases: {
          discoverReviewedRelease: async () => ({
            repository: config.repository,
            releaseId,
            headSha: reviewHeadSha,
            pullRequestNumber: 26,
            status: "REVIEWED",
            decision: "BLOCK",
            deploymentStrategy: "BLOCKED",
            initialTrafficPercent: 0,
          }),
        },
        createDeploymentAttemptId: () =>
          attemptId,
      },
    ),
    /CONTINUE/u,
  );
});

test("rejects repository, pull-request, and strategy mismatches", async () => {
  const invalidReleases = [
    {
      repository: {
        owner: "OTHER",
        name: "the-autonomous-canary",
      },
      pullRequestNumber: 26,
      deploymentStrategy: "CANARY",
      initialTrafficPercent: 5,
    },
    {
      repository: config.repository,
      pullRequestNumber: 27,
      deploymentStrategy: "CANARY",
      initialTrafficPercent: 5,
    },
    {
      repository: config.repository,
      pullRequestNumber: 26,
      deploymentStrategy: "STANDARD",
      initialTrafficPercent: 5,
    },
  ];

  for (const invalid of invalidReleases) {
    await assert.rejects(
      discoverRenderDeploymentCorrelation(
        config,
        {
          render: {
            discoverLiveDeployment: async () => ({
              deploymentId: "dep-unit-test",
              commitSha: deployedCommitSha,
            }),
          },
          github: {
            discoverMergedPullRequest: async () => ({
              pullRequestNumber: 26,
              headSha: reviewHeadSha,
            }),
          },
          releases: {
            discoverReviewedRelease: async () => ({
              ...invalid,
              releaseId,
              headSha: reviewHeadSha,
              status: "REVIEWED",
              decision: "CONTINUE",
            }),
          },
        },
      ),
      /repository- and pull-request-bound/u,
    );
  }
});

test("Render discovery requires exactly one live exact-commit deploy", async () => {
  const responses = [
    [],
    [
      {
        deploy: {
          id: "dep-one",
          status: "live",
          commit: {
            id: deployedCommitSha,
          },
        },
      },
      {
        deploy: {
          id: "dep-two",
          status: "live",
          commit: {
            id: deployedCommitSha,
          },
        },
      },
    ],
    [
      {
        deploy: {
          id: "dep-failed",
          status: "build_failed",
          commit: {
            id: deployedCommitSha,
          },
        },
      },
    ],
  ];

  for (const body of responses) {
    const discovery =
      new RenderApiDeploymentDiscovery({
        fetchImplementation: async () =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: {
              "content-type":
                "application/json",
            },
          }),
      });

    await assert.rejects(
      discovery.discoverLiveDeployment({
        serviceId: "srv-unit-test",
        apiKey: config.renderApiKey,
        commitSha: deployedCommitSha,
        timeoutMs: 10_000,
      }),
      /exactly one live deployment/u,
    );
  }
});

test("Render discovery bounds provider failures without exposing secrets", async () => {
  const secret = config.renderApiKey;
  const failures: Array<() => Promise<Response>> = [
    async () => new Response(
      `provider body ${secret}`,
      {
        status: 401,
      },
    ),
    async () => new Response(
      "x".repeat(256 * 1_024 + 1),
      {
        status: 200,
      },
    ),
    async (_url?: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(
            new Error("provider timeout secret"),
          ),
        );
      }),
  ];

  for (const [index, failure] of failures.entries()) {
    const discovery =
      new RenderApiDeploymentDiscovery({
        fetchImplementation:
          failure as typeof fetch,
      });

    await assert.rejects(
      discovery.discoverLiveDeployment({
        serviceId: "srv-unit-test",
        apiKey: secret,
        commitSha: deployedCommitSha,
        timeoutMs: index === 2 ? 1 : 10_000,
      }),
      (error: unknown) => {
        assert.equal(
          String(error).includes(secret),
          false,
        );

        return true;
      },
    );
  }
});
