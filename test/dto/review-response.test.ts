import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseReviewResponse,
} from "../../src/dto/review-response.js";

function createFinding() {
  return {
    code: "TESTS_FAILED",
    source: "DETERMINISTIC",
    severity: "CRITICAL",
    title: "Automated tests failed",
    explanation: "The submitted test evidence reports a failure.",
  };
}

function createCommonResponse() {
  return {
    reviewId: "123e4567-e89b-42d3-a456-426614174000",
    repository: {
      owner: "RWAMBA",
      name: "the-autonomous-canary",
    },
    headSha: "1234567890abcdef",
    risk: {
      score: 95,
      level: "CRITICAL",
    },
    summary: "The release is blocked by deterministic policy.",
    findings: [
      createFinding(),
    ],
    requiredActions: [
      "Repair the failing tests and submit new evidence.",
    ],
    policyOverrides: [
      "TESTS_FAILED",
    ],
    analysis: {
      provider: "MOCK",
      modelTarget: "mock-canaryguard-v1",
      promptVersion: "review-v1",
    },
  };
}

test("accepts a blocked review with zero deployment traffic", () => {
  const input = {
    ...createCommonResponse(),
    decision: "BLOCK",
    deployment: {
      strategy: "BLOCKED",
      initialTrafficPercent: 0,
    },
  };

  assert.deepEqual(
    parseReviewResponse(input),
    input,
  );
});

test("accepts a canary deployment for a continuing review", () => {
  const input = {
    ...createCommonResponse(),
    decision: "CONTINUE",
    risk: {
      score: 45,
      level: "MEDIUM",
    },
    deployment: {
      strategy: "CANARY",
      initialTrafficPercent: 10,
    },
    policyOverrides: [],
  };

  assert.deepEqual(
    parseReviewResponse(input),
    input,
  );
});

test("accepts a standard deployment at full traffic", () => {
  const input = {
    ...createCommonResponse(),
    decision: "CONTINUE",
    risk: {
      score: 10,
      level: "LOW",
    },
    deployment: {
      strategy: "STANDARD",
      initialTrafficPercent: 100,
    },
    policyOverrides: [],
  };

  assert.deepEqual(
    parseReviewResponse(input),
    input,
  );
});

test("rejects a blocked review with canary traffic", () => {
  assert.throws(() => parseReviewResponse({
    ...createCommonResponse(),
    decision: "BLOCK",
    deployment: {
      strategy: "CANARY",
      initialTrafficPercent: 10,
    },
  }));
});

test("rejects a continuing review with a blocked deployment", () => {
  assert.throws(() => parseReviewResponse({
    ...createCommonResponse(),
    decision: "CONTINUE",
    deployment: {
      strategy: "BLOCKED",
      initialTrafficPercent: 0,
    },
  }));
});

test("rejects an invalid canary traffic percentage", () => {
  assert.throws(() => parseReviewResponse({
    ...createCommonResponse(),
    decision: "CONTINUE",
    deployment: {
      strategy: "CANARY",
      initialTrafficPercent: 100,
    },
  }));
});

test("rejects unauthorized raw model output", () => {
  assert.throws(() => parseReviewResponse({
    ...createCommonResponse(),
    decision: "BLOCK",
    deployment: {
      strategy: "BLOCKED",
      initialTrafficPercent: 0,
    },
    rawModelOutput: {
      decision: "CONTINUE",
    },
  }));
});

test("rejects a malformed finding code", () => {
  assert.throws(() => parseReviewResponse({
    ...createCommonResponse(),
    decision: "BLOCK",
    deployment: {
      strategy: "BLOCKED",
      initialTrafficPercent: 0,
    },
    findings: [
      {
        ...createFinding(),
        code: "invalid-code",
      },
    ],
  }));
});
