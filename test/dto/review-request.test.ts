import assert from "node:assert/strict";
import { test } from "node:test";

import {
  maximumDiffLength,
  maximumSecurityFindings,
  parseReviewRequest,
} from "../../src/dto/review-request.js";

function createValidRequest() {
  return {
    repository: {
      owner: "RWAMBA",
      name: "the-autonomous-canary",
    },
    change: {
      title: "Add the CanaryGuard review API",
      description: "Introduces structured release-risk analysis.",
      baseSha: "abcdef1234567890",
      headSha: "1234567890abcdef",
      diff: "+export const reviewEnabled = true;",
    },
    evidence: {
      testStatus: "passed",
      securityFindings: [],
    },
  };
}

test("accepts and normalizes a valid review request", () => {
  const request = createValidRequest();

  const result = parseReviewRequest({
    ...request,
    repository: {
      owner: " RWAMBA ",
      name: " the-autonomous-canary ",
    },
    change: {
      ...request.change,
      title: " Add the CanaryGuard review API ",
    },
    evidence: {
      testStatus: "passed",
    },
  });

  assert.deepEqual(result, {
    repository: {
      owner: "RWAMBA",
      name: "the-autonomous-canary",
    },
    change: {
      title: "Add the CanaryGuard review API",
      description: "Introduces structured release-risk analysis.",
      baseSha: "abcdef1234567890",
      headSha: "1234567890abcdef",
      diff: "+export const reviewEnabled = true;",
    },
    evidence: {
      testStatus: "passed",
      securityFindings: [],
    },
  });
});

test("rejects an unauthorized decision field", () => {
  assert.throws(() => parseReviewRequest({
    ...createValidRequest(),
    decision: "CONTINUE",
  }));
});

test("rejects an oversized Git diff", () => {
  const request = createValidRequest();

  assert.throws(() => parseReviewRequest({
    ...request,
    change: {
      ...request.change,
      diff: "a".repeat(maximumDiffLength + 1),
    },
  }));
});

test("rejects too many security findings", () => {
  const request = createValidRequest();

  const securityFindings = Array.from(
    {
      length: maximumSecurityFindings + 1,
    },
    (_, index) => ({
      identifier: `finding-${index}`,
      source: "Trivy",
      severity: "high",
      title: `Security finding ${index}`,
    }),
  );

  assert.throws(() => parseReviewRequest({
    ...request,
    evidence: {
      ...request.evidence,
      securityFindings,
    },
  }));
});

test("rejects an invalid commit SHA", () => {
  const request = createValidRequest();

  assert.throws(() => parseReviewRequest({
    ...request,
    change: {
      ...request.change,
      headSha: "not-a-git-sha",
    },
  }));
});

test("rejects an invalid test status", () => {
  const request = createValidRequest();

  assert.throws(() => parseReviewRequest({
    ...request,
    evidence: {
      ...request.evidence,
      testStatus: "green",
    },
  }));
});
