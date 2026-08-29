import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  DefaultReviewController,
} from "../../src/controllers/review-controller.js";
import type {
  ReviewRequestDto,
} from "../../src/dto/review-request.js";
import {
  DefaultDeterministicEngine,
} from "../../src/engines/deterministic/deterministic-engine.js";
import type {
  DeterministicEngine,
} from "../../src/engines/deterministic/deterministic-engine.js";
import type {
  IntelligenceEngine,
} from "../../src/engines/intelligence/intelligence-engine.js";
import type {
  IntelligenceTelemetryLogInput,
  IntelligenceTelemetryLogger,
} from "../../src/engines/intelligence/intelligence-telemetry.js";
import {
  MockIntelligenceEngine,
} from "../../src/engines/intelligence/mock-intelligence-engine.js";
import type {
  PolicyEngine,
} from "../../src/engines/policy/policy-engine.js";

const reviewId =
  "123e4567-e89b-42d3-a456-426614174000";

function createValidInput(
  testStatus:
    | "passed"
    | "failed"
    | "unknown" = "passed",
  diff =
    "+export const reviewEnabled = true;",
  ci?: unknown,
) {
  return {
    repository: {
      owner: "RWAMBA",
      name: "the-autonomous-canary",
    },
    change: {
      title: "Review a candidate release",
      description:
        "Validated release review data.",
      baseSha: "abcdef1234567890",
      headSha: "1234567890abcdef",
      diff,
    },
    evidence: {
      testStatus,
      securityFindings: [],
      ...(
        ci === undefined
          ? {}
          : {
              ci,
            }
      ),
    },
  };
}

function createTelemetryCollector(): {
  readonly logger:
    IntelligenceTelemetryLogger;
  readonly records:
    IntelligenceTelemetryLogInput[];
} {
  const records:
    IntelligenceTelemetryLogInput[] = [];

  return {
    records,
    logger: {
      log(input): void {
        records.push(input);
      },
    },
  };
}

test("processes a clean review through the complete pipeline", async () => {
  const telemetry =
    createTelemetryCollector();

  const controller =
    new DefaultReviewController({
      intelligenceEngine:
        new MockIntelligenceEngine({
          now: () => 100,
        }),
      telemetryLogger:
        telemetry.logger,
      createReviewId:
        () => reviewId,
    });

  const result =
    await controller.createReview(
      createValidInput(),
    );

  assert.equal(
    result.reviewId,
    reviewId,
  );

  assert.equal(
    result.decision,
    "CONTINUE",
  );

  assert.deepEqual(result.deployment, {
    strategy: "STANDARD",
    initialTrafficPercent: 100,
  });

  assert.equal(
    telemetry.records.length,
    1,
  );

  assert.equal(
    telemetry.records[0]?.reviewId,
    reviewId,
  );

  assert.equal(
    telemetry.records[0]
      ?.telemetry
      .provider,
    "MOCK",
  );
});

test("blocks failed tests despite a mock continue recommendation", async () => {
  const telemetry =
    createTelemetryCollector();

  const intelligenceEngine =
    new MockIntelligenceEngine({
      now: () => 100,
      assessment: {
        advisoryDecision: "CONTINUE",
        riskScore: 5,
        riskLevel: "LOW",
        summary:
          "The mock recommends continuing.",
        findings: [],
        requiredActions: [],
        ciDiagnosis: null,
        advisoryDeployment: {
          strategy: "STANDARD",
          initialTrafficPercent: 100,
        },
      },
    });

  const controller =
    new DefaultReviewController({
      intelligenceEngine,
      telemetryLogger:
        telemetry.logger,
      createReviewId:
        () => reviewId,
    });

  const result =
    await controller.createReview(
      createValidInput("failed"),
    );

  assert.equal(
    result.decision,
    "BLOCK",
  );

  assert.deepEqual(
    result.policyOverrides,
    [
      "TESTS_FAILED",
    ],
  );

  assert.deepEqual(result.deployment, {
    strategy: "BLOCKED",
    initialTrafficPercent: 0,
  });
});

test("sends only sanitized copies to both analysis engines", async () => {
  const fakeApiKey =
    "sk-proj-abcdefghijklmnopqrstuvwxyz123456";
  const fakeGitHubToken =
    "ghp_abcdefghijklmnopqrstuvwxyz1234567890";

  const input = createValidInput(
    "passed",
    `+OPENAI_API_KEY=${fakeApiKey}`,
    {
      provider: "GITHUB_ACTIONS",
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
              conclusion: "failure",
              logExcerpt:
                `token=${fakeGitHubToken}`,
            },
          ],
        },
      ],
    },
  );

  const originalInput =
    JSON.stringify(input);

  let deterministicRequest:
    ReviewRequestDto | undefined;

  let intelligenceRequest:
    ReviewRequestDto | undefined;

  const defaultDeterministicEngine =
    new DefaultDeterministicEngine();

  const deterministicEngine:
    DeterministicEngine = {
      analyze(request) {
        deterministicRequest = request;

        return defaultDeterministicEngine
          .analyze(request);
      },
    };

  const mockIntelligenceEngine =
    new MockIntelligenceEngine({
      now: () => 100,
    });

  const intelligenceEngine:
    IntelligenceEngine = {
      async analyze(request) {
        intelligenceRequest = request;

        return mockIntelligenceEngine
          .analyze(request);
      },
    };

  const telemetry =
    createTelemetryCollector();

  const controller =
    new DefaultReviewController({
      deterministicEngine,
      intelligenceEngine,
      telemetryLogger:
        telemetry.logger,
      createReviewId:
        () => reviewId,
    });

  const result =
    await controller.createReview(input);

  assert.ok(deterministicRequest);
  assert.ok(intelligenceRequest);

  assert.equal(
    deterministicRequest
      .change
      .diff
      .includes(fakeApiKey),
    false,
  );

  assert.equal(
    intelligenceRequest
      .change
      .diff
      .includes(fakeApiKey),
    false,
  );

  assert.equal(
    deterministicRequest
      .change
      .diff
      .includes(
        "[REDACTED:OPENAI_API_KEY]",
      ),
    true,
  );

  const deterministicCi =
    deterministicRequest.evidence.ci;
  const intelligenceCi =
    intelligenceRequest.evidence.ci;

  assert.ok(deterministicCi);
  assert.ok(intelligenceCi);

  assert.equal(
    JSON.stringify(deterministicCi)
      .includes(fakeGitHubToken),
    false,
  );

  assert.equal(
    JSON.stringify(intelligenceCi)
      .includes(fakeGitHubToken),
    false,
  );

  assert.equal(
    JSON.stringify(deterministicCi)
      .includes(
        "[REDACTED:GITHUB_TOKEN]",
      ),
    true,
  );

  assert.equal(
    intelligenceRequest
      .change
      .diff
      .includes(
        "[REDACTED:OPENAI_API_KEY]",
      ),
    true,
  );

  assert.equal(
    JSON.stringify(input),
    originalInput,
  );

  assert.equal(
    JSON.stringify(result)
      .includes(fakeApiKey),
    false,
  );
});

test("rejects invalid input before running engines or telemetry", async () => {
  let deterministicCalls = 0;
  let intelligenceCalls = 0;
  let telemetryCalls = 0;

  const defaultDeterministicEngine =
    new DefaultDeterministicEngine();

  const deterministicEngine:
    DeterministicEngine = {
      analyze(request) {
        deterministicCalls += 1;

        return defaultDeterministicEngine
          .analyze(request);
      },
    };

  const mockIntelligenceEngine =
    new MockIntelligenceEngine({
      now: () => 100,
    });

  const intelligenceEngine:
    IntelligenceEngine = {
      async analyze(request) {
        intelligenceCalls += 1;

        return mockIntelligenceEngine
          .analyze(request);
      },
    };

  const controller =
    new DefaultReviewController({
      deterministicEngine,
      intelligenceEngine,
      telemetryLogger: {
        log(): void {
          telemetryCalls += 1;
        },
      },
      createReviewId:
        () => reviewId,
    });

  await assert.rejects(
    controller.createReview({
      invalid: true,
    }),
    {
      name: "ZodError",
    },
  );

  assert.equal(
    deterministicCalls,
    0,
  );

  assert.equal(
    intelligenceCalls,
    0,
  );

  assert.equal(
    telemetryCalls,
    0,
  );
});

test("rejects an invalid generated review identifier before analysis", async () => {
  let deterministicCalls = 0;
  let intelligenceCalls = 0;

  const defaultDeterministicEngine =
    new DefaultDeterministicEngine();

  const deterministicEngine:
    DeterministicEngine = {
      analyze(request) {
        deterministicCalls += 1;

        return defaultDeterministicEngine
          .analyze(request);
      },
    };

  const mockIntelligenceEngine =
    new MockIntelligenceEngine({
      now: () => 100,
    });

  const intelligenceEngine:
    IntelligenceEngine = {
      async analyze(request) {
        intelligenceCalls += 1;

        return mockIntelligenceEngine
          .analyze(request);
      },
    };

  const controller =
    new DefaultReviewController({
      deterministicEngine,
      intelligenceEngine,
      telemetryLogger: {
        log(): void {
          throw new Error(
            "Telemetry must not run.",
          );
        },
      },
      createReviewId:
        () => "invalid-review-id",
    });

  await assert.rejects(
    controller.createReview(
      createValidInput(),
    ),
    {
      name: "ZodError",
    },
  );

  assert.equal(
    deterministicCalls,
    0,
  );

  assert.equal(
    intelligenceCalls,
    0,
  );
});

test("does not log or apply policy when intelligence analysis fails", async () => {
  let telemetryCalls = 0;
  let policyCalls = 0;

  const intelligenceEngine:
    IntelligenceEngine = {
      async analyze() {
        throw new Error(
          "Simulated intelligence failure.",
        );
      },
    };

  const policyEngine:
    PolicyEngine = {
      evaluate() {
        policyCalls += 1;

        throw new Error(
          "Policy must not run.",
        );
      },
    };

  const controller =
    new DefaultReviewController({
      intelligenceEngine,
      policyEngine,
      telemetryLogger: {
        log(): void {
          telemetryCalls += 1;
        },
      },
      createReviewId:
        () => reviewId,
    });

  await assert.rejects(
    controller.createReview(
      createValidInput(),
    ),
    {
      message:
        "Simulated intelligence failure.",
    },
  );

  assert.equal(
    telemetryCalls,
    0,
  );

  assert.equal(
    policyCalls,
    0,
  );
});

test("does not issue a policy decision when telemetry fails", async () => {
  let policyCalls = 0;

  const policyEngine:
    PolicyEngine = {
      evaluate() {
        policyCalls += 1;

        throw new Error(
          "Policy must not run.",
        );
      },
    };

  const controller =
    new DefaultReviewController({
      intelligenceEngine:
        new MockIntelligenceEngine({
          now: () => 100,
        }),
      policyEngine,
      telemetryLogger: {
        log(): void {
          throw new Error(
            "Telemetry unavailable.",
          );
        },
      },
      createReviewId:
        () => reviewId,
    });

  await assert.rejects(
    controller.createReview(
      createValidInput(),
    ),
    {
      message:
        "Telemetry unavailable.",
    },
  );

  assert.equal(
    policyCalls,
    0,
  );
});
