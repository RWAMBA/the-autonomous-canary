import assert from "node:assert/strict";
import {
  generateKeyPairSync,
} from "node:crypto";
import {
  test,
} from "node:test";

import {
  GitHubAppApiClient,
} from "../../src/github/github-api-client.js";
import type {
  GitHubAppConfig,
} from "../../src/github/github-app-config.js";

const deployedCommitSha =
  "be147dd651fb58388d2864203d6377df74a828f9";
const reviewHeadSha =
  "3128a8c383889ae107e9a999778be70a2263a21a";
const installationToken =
  "unit-test-installation-token-value";

const config: GitHubAppConfig = {
  provider: "APP",
  axeEvidenceProvider: "AXE",
  clientId: "Iv23unit-test-client",
  privateKey: generateKeyPairSync(
    "rsa",
    {
      modulusLength: 2_048,
    },
  ).privateKey,
  timeoutMs: 10_000,
};

test("correlates a deployed commit to exactly one merged pull request", async () => {
  const requests: string[] = [];
  const client = new GitHubAppApiClient(
    config,
    {
      clock: () =>
        Date.parse("2026-09-08T12:30:00Z"),
      fetchImplementation: async (url, init) => {
        const requestUrl = String(url);
        requests.push(requestUrl);

        if (requestUrl.endsWith("/installation")) {
          return new Response(JSON.stringify({
            id: 901,
            suspended_at: null,
            permissions: {
              actions: "read",
              pull_requests: "read",
            },
          }), {
            status: 200,
          });
        }

        if (requestUrl.endsWith("/access_tokens")) {
          assert.equal(init?.method, "POST");
          assert.match(
            String(init?.body),
            /"pull_requests":"read"/u,
          );

          return new Response(JSON.stringify({
            token: installationToken,
            expires_at:
              "2026-09-08T13:30:00Z",
            permissions: {
              pull_requests: "read",
            },
          }), {
            status: 201,
          });
        }

        assert.equal(
          new Headers(init?.headers)
            .get("authorization"),
          `Bearer ${installationToken}`,
        );

        return new Response(JSON.stringify([
          {
            number: 26,
            state: "closed",
            merged_at:
              "2026-09-08T12:26:48Z",
            head: {
              sha: reviewHeadSha,
            },
            base: {
              repo: {
                full_name:
                  "RWAMBA/the-autonomous-canary",
              },
            },
          },
        ]), {
          status: 200,
        });
      },
    },
  );

  assert.deepEqual(
    await client.discoverMergedPullRequest({
      repository: {
        owner: "RWAMBA",
        name: "the-autonomous-canary",
      },
      commitSha: deployedCommitSha,
    }),
    {
      pullRequestNumber: 26,
      headSha: reviewHeadSha,
    },
  );
  assert.match(
    requests.at(-1) ?? "",
    new RegExp(
      `/commits/${deployedCommitSha}/pulls\\?per_page=2$`,
      "u",
    ),
  );
});
