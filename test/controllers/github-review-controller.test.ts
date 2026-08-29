import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  DefaultGitHubReviewController,
} from "../../src/controllers/github-review-controller.js";
import {
  DefaultReviewController,
} from "../../src/controllers/review-controller.js";
import {
  parseCiEvidence,
} from "../../src/dto/ci-evidence.js";
import type {
  GitHubCiCollectionRequest,
} from "../../src/github/github-api-client.js";

const reviewId =
  "123e4567-e89b-42d3-a456-426614174000";

function createRequest() {
  return {
    repository: {
      owner: "RWAMBA",
      name: "the-autonomous-canary",
    },
    change: {
      title:
        "Collect GitHub Actions evidence",
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

test("collects authoritative CI evidence before using the existing review pipeline", async () => {
  let collectionRequest:
    GitHubCiCollectionRequest
    | undefined;

  const controller =
    new DefaultGitHubReviewController({
      evidenceCollector: {
        collect: (request) => {
          collectionRequest = request;

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
      reviewController:
        new DefaultReviewController({
          createReviewId:
            () => reviewId,
          telemetryLogger: {
            log: () => undefined,
          },
        }),
    });

  const input = createRequest();
  const inputBefore =
    JSON.stringify(input);

  const review =
    await controller.createReview(input);

  assert.deepEqual(
    collectionRequest,
    {
      repository: input.repository,
      runId: input.github.runId,
      expectedHeadSha:
        input.change.headSha,
    },
  );
  assert.equal(
    review.reviewId,
    reviewId,
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
    JSON.stringify(input),
    inputBefore,
  );
});

test("does not run review analysis when GitHub evidence collection fails", async () => {
  let reviewCalls = 0;

  const controller =
    new DefaultGitHubReviewController({
      evidenceCollector: {
        collect: () =>
          Promise.reject(
            new Error(
              "Synthetic collection failure",
            ),
          ),
      },
      reviewController: {
        createReview: () => {
          reviewCalls += 1;

          throw new Error(
            "Review should not run.",
          );
        },
      },
    });

  await assert.rejects(
    controller.createReview(
      createRequest(),
    ),
    {
      message:
        "Synthetic collection failure",
    },
  );

  assert.equal(reviewCalls, 0);
});
