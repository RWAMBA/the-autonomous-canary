import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  parseGitHubReviewRequest,
} from "../../src/dto/github-review-request.js";

function createRequest() {
  return {
    repository: {
      owner: "RWAMBA",
      name: "the-autonomous-canary",
    },
    change: {
      title:
        "Collect GitHub Actions evidence",
      description:
        "Use a GitHub App installation token.",
      baseSha:
        "3c4857c676c61f0ca6fca280c28ad6e0c400e44d",
      headSha:
        "42c3e7abfc89e50027866028a87a216177dcdd89",
      diff:
        "+export const githubAppEnabled = true;",
    },
    evidence: {
      testStatus: "passed",
      securityFindings: [],
    },
    github: {
      runId: 33_271_855_575,
    },
  };
}

test("accepts a bounded GitHub review request", () => {
  const input = createRequest();

  assert.deepEqual(
    parseGitHubReviewRequest(input),
    input,
  );
});

test("rejects caller-supplied CI evidence on the GitHub App route", () => {
  const input = createRequest();

  assert.throws(
    () => parseGitHubReviewRequest({
      ...input,
      evidence: {
        ...input.evidence,
        ci: {
          provider:
            "GITHUB_ACTIONS",
        },
      },
    }),
  );
});

test("rejects invalid run identifiers and unknown GitHub fields", () => {
  const input = createRequest();

  assert.throws(
    () => parseGitHubReviewRequest({
      ...input,
      github: {
        runId: 0,
      },
    }),
  );

  assert.throws(
    () => parseGitHubReviewRequest({
      ...input,
      github: {
        runId: input.github.runId,
        installationToken:
          "caller-controlled-token",
      },
    }),
  );
});
