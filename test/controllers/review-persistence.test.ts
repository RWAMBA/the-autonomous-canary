import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  DefaultReviewController,
} from "../../src/controllers/review-controller.js";
import type {
  ReviewLifecycleRecord,
} from "../../src/persistence/release-lifecycle-store.js";

const releaseId =
  "123e4567-e89b-42d3-a456-426614174000";

const input = {
  repository: {
    owner: "RWAMBA",
    name: "the-autonomous-canary",
  },
  change: {
    title: "Persist the release lifecycle",
    description:
      "Store normalized release evidence.",
    baseSha: "abcdef1234567890",
    headSha: "1234567890abcdef",
    diff:
      "+export const persisted = true;",
  },
  evidence: {
    testStatus: "passed",
    securityFindings: [],
  },
};

test("uses the correlated release identifier and records the final policy result", async () => {
  const records:
    ReviewLifecycleRecord[] = [];

  const response =
    await new DefaultReviewController({
      lifecycleRecorder: {
        resolveReleaseId: async () =>
          releaseId,
        recordReview: async (record) => {
          records.push(record);
        },
      },
    }).createReview(
      input,
      {
        releaseId,
      },
    );

  assert.equal(
    response.reviewId,
    releaseId,
  );
  assert.equal(records.length, 1);
  assert.equal(
    records[0]?.response.decision,
    response.decision,
  );
  assert.equal(
    records[0]?.releaseId,
    releaseId,
  );
});

test("does not return an unrecorded policy decision when persistence fails", async () => {
  await assert.rejects(
    new DefaultReviewController({
      lifecycleRecorder: {
        resolveReleaseId: async (
          _request,
          proposedReleaseId,
        ) => proposedReleaseId,
        recordReview: async () => {
          throw new Error(
            "database unavailable",
          );
        },
      },
    }).createReview(input),
    /database unavailable/u,
  );
});

test("reuses the stored release identifier for repeated reviews of one head commit", async () => {
  const records:
    ReviewLifecycleRecord[] = [];

  const response =
    await new DefaultReviewController({
      createReviewId: () =>
        "123e4567-e89b-42d3-a456-426614174999",
      lifecycleRecorder: {
        resolveReleaseId: async () =>
          releaseId,
        recordReview: async (record) => {
          records.push(record);
        },
      },
    }).createReview(input);

  assert.equal(response.reviewId, releaseId);
  assert.equal(records[0]?.releaseId, releaseId);
});

test("rejects a webhook release identifier that conflicts with stored correlation", async () => {
  await assert.rejects(
    new DefaultReviewController({
      lifecycleRecorder: {
        resolveReleaseId: async () =>
          "123e4567-e89b-42d3-a456-426614174999",
        recordReview: async () => {},
      },
    }).createReview(input, {
      releaseId,
    }),
    /correlated release identifier/u,
  );
});
