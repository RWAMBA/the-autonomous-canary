import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  parseCiEvidence,
} from "../../src/dto/ci-evidence.js";
import type {
  CiEvidenceDto,
} from "../../src/dto/ci-evidence.js";
import {
  parseReviewRequest,
} from "../../src/dto/review-request.js";
import type {
  ReviewRequestDto,
} from "../../src/dto/review-request.js";
import {
  DefaultDeterministicEngine,
} from "../../src/engines/deterministic/deterministic-engine.js";
import {
  parseIntelligenceResult,
} from "../../src/engines/intelligence/intelligence-engine.js";
import type {
  IntelligenceAssessment,
  IntelligenceResult,
} from "../../src/engines/intelligence/intelligence-engine.js";
import {
  DefaultPolicyEngine,
} from "../../src/engines/policy/policy-engine.js";

const reviewId =
  "123e4567-e89b-42d3-a456-426614174000";

function createRequest(
  testStatus: ReviewRequestDto[
    "evidence"
  ]["testStatus"] = "passed",
  securityFindings: ReviewRequestDto[
    "evidence"
  ]["securityFindings"] = [],
  ci?: CiEvidenceDto,
): ReviewRequestDto {
  return parseReviewRequest({
    repository: {
      owner: "RWAMBA",
      name: "the-autonomous-canary",
    },
    change: {
      title: "Review a candidate release",
      description:
        "Validated and sanitized release data.",
      baseSha: "abcdef1234567890",
      headSha: "1234567890abcdef",
      diff:
        "+export const reviewEnabled = true;",
    },
    evidence: {
      testStatus,
      securityFindings,
      ...(
        ci === undefined
          ? {}
          : {
              ci,
            }
      ),
    },
  });
}

function createCiEvidence(
  conclusion:
    | "failure"
    | "cancelled",
): CiEvidenceDto {
  return parseCiEvidence({
    provider: "GITHUB_ACTIONS",
    workflowName:
      "Continuous Integration",
    runId: 33_262_408_116,
    runAttempt: 1,
    conclusion,
    jobs: [
      {
        jobId: 101,
        name: "quality",
        conclusion,
        steps: [
          {
            number: 4,
            name: "Test",
            conclusion,
          },
        ],
      },
    ],
  });
}

const defaultAssessment:
  IntelligenceAssessment = {
    advisoryDecision: "CONTINUE",
    riskScore: 20,
    riskLevel: "LOW",
    summary:
      "The mock assessment found low release risk.",
    findings: [],
    requiredActions: [],
    advisoryDeployment: {
      strategy: "STANDARD",
      initialTrafficPercent: 100,
    },
  };

function createIntelligenceResult(
  overrides: Partial<
    IntelligenceAssessment
  > = {},
): IntelligenceResult {
  return parseIntelligenceResult({
    assessment: {
      ...defaultAssessment,
      ...overrides,
    },
    telemetry: {
      provider: "MOCK",
      modelTarget: "mock-canaryguard-v1",
      promptVersion: "canaryguard-review-v2",
      inputTokens: 15,
      outputTokens: 5,
      totalTokens: 20,
      latencyMs: 25,
      attempts: 1,
    },
  });
}

function evaluate(
  request: ReviewRequestDto,
  intelligenceResult:
    IntelligenceResult =
      createIntelligenceResult(),
) {
  const deterministicAssessment =
    new DefaultDeterministicEngine()
      .analyze(request);

  return new DefaultPolicyEngine().evaluate({
    reviewId,
    request,
    deterministicAssessment,
    intelligenceResult,
  });
}

test("continues a clean low-risk release at full traffic", () => {
  const result = evaluate(
    createRequest(),
  );

  assert.equal(
    result.decision,
    "CONTINUE",
  );

  assert.deepEqual(result.risk, {
    score: 20,
    level: "LOW",
  });

  assert.deepEqual(result.deployment, {
    strategy: "STANDARD",
    initialTrafficPercent: 100,
  });

  assert.deepEqual(
    result.policyOverrides,
    [],
  );

  assert.deepEqual(result.analysis, {
    provider: "MOCK",
    modelTarget: "mock-canaryguard-v1",
    promptVersion: "canaryguard-review-v2",
  });
});

test("failed tests override an AI continue recommendation", () => {
  const result = evaluate(
    createRequest("failed"),
    createIntelligenceResult({
      advisoryDecision: "CONTINUE",
      riskScore: 5,
      riskLevel: "LOW",
      summary:
        "The AI recommends continuing.",
    }),
  );

  assert.equal(
    result.decision,
    "BLOCK",
  );

  assert.deepEqual(result.risk, {
    score: 90,
    level: "CRITICAL",
  });

  assert.deepEqual(result.deployment, {
    strategy: "BLOCKED",
    initialTrafficPercent: 0,
  });

  assert.deepEqual(
    result.policyOverrides,
    [
      "TESTS_FAILED",
    ],
  );

  assert.deepEqual(
    result.findings.map(
      (finding) => finding.code,
    ),
    [
      "TESTS_FAILED",
      "DETERMINISTIC_POLICY_OVERRIDE",
    ],
  );

  assert.ok(
    result.requiredActions.includes(
      "Repair the failing automated tests and submit new evidence.",
    ),
  );

  assert.equal(
    result.summary,
    "Release blocked by hard-coded policy: TESTS_FAILED.",
  );
});

test("a critical security finding overrides AI continuation", () => {
  const result = evaluate(
    createRequest(
      "passed",
      [
        {
          identifier: "CVE-TEST-1",
          source: "Trivy",
          severity: "critical",
          title:
            "Critical dependency vulnerability",
          file: "package-lock.json",
        },
      ],
    ),
    createIntelligenceResult({
      advisoryDecision: "CONTINUE",
      riskScore: 10,
      riskLevel: "LOW",
    }),
  );

  assert.equal(
    result.decision,
    "BLOCK",
  );

  assert.deepEqual(
    result.policyOverrides,
    [
      "SECURITY_FINDING_CRITICAL",
    ],
  );

  assert.ok(
    result.requiredActions.includes(
      "Resolve every critical security finding before release.",
    ),
  );

  assert.deepEqual(result.deployment, {
    strategy: "BLOCKED",
    initialTrafficPercent: 0,
  });
});

test("failed CI evidence overrides AI continuation and exposes a log-free investigation", () => {
  const result = evaluate(
    createRequest(
      "passed",
      [],
      createCiEvidence("failure"),
    ),
    createIntelligenceResult({
      advisoryDecision: "CONTINUE",
      riskScore: 5,
      riskLevel: "LOW",
    }),
  );

  assert.equal(
    result.decision,
    "BLOCK",
  );
  assert.deepEqual(
    result.policyOverrides,
    [
      "CI_FAILED",
    ],
  );
  assert.equal(
    result.ciInvestigation?.outcome,
    "FAILED",
  );
  assert.ok(
    result.requiredActions.includes(
      "Repair the failed GitHub Actions jobs or steps and submit a completed successful run.",
    ),
  );
  assert.equal(
    JSON.stringify(
      result.ciInvestigation,
    ).includes("logExcerpt"),
    false,
  );
});

test("incomplete CI evidence forces high-risk canary routing without blocking", () => {
  const result = evaluate(
    createRequest(
      "passed",
      [],
      createCiEvidence("cancelled"),
    ),
    createIntelligenceResult({
      riskScore: 5,
      riskLevel: "LOW",
    }),
  );

  assert.equal(
    result.decision,
    "CONTINUE",
  );
  assert.deepEqual(result.risk, {
    score: 70,
    level: "HIGH",
  });
  assert.deepEqual(result.deployment, {
    strategy: "CANARY",
    initialTrafficPercent: 5,
  });
  assert.deepEqual(
    result.policyOverrides,
    [],
  );
});

test("preserves a cautious AI block recommendation", () => {
  const result = evaluate(
    createRequest(),
    createIntelligenceResult({
      advisoryDecision: "BLOCK",
      riskScore: 45,
      riskLevel: "MEDIUM",
      summary:
        "The intelligence assessment recommends blocking.",
      advisoryDeployment: {
        strategy: "BLOCKED",
        initialTrafficPercent: 0,
      },
    }),
  );

  assert.equal(
    result.decision,
    "BLOCK",
  );

  assert.deepEqual(
    result.policyOverrides,
    [],
  );

  assert.equal(
    result.summary,
    "The intelligence assessment recommends blocking.",
  );

  assert.deepEqual(result.deployment, {
    strategy: "BLOCKED",
    initialTrafficPercent: 0,
  });
});

test("forces a small canary for high risk", () => {
  const result = evaluate(
    createRequest(),
    createIntelligenceResult({
      riskScore: 75,
      riskLevel: "HIGH",
      advisoryDeployment: {
        strategy: "STANDARD",
        initialTrafficPercent: 100,
      },
    }),
  );

  assert.equal(
    result.decision,
    "CONTINUE",
  );

  assert.deepEqual(result.risk, {
    score: 75,
    level: "HIGH",
  });

  assert.deepEqual(result.deployment, {
    strategy: "CANARY",
    initialTrafficPercent: 5,
  });
});

test("forces a canary deployment for medium risk", () => {
  const result = evaluate(
    createRequest(),
    createIntelligenceResult({
      riskScore: 45,
      riskLevel: "MEDIUM",
    }),
  );

  assert.equal(
    result.decision,
    "CONTINUE",
  );

  assert.deepEqual(result.deployment, {
    strategy: "CANARY",
    initialTrafficPercent: 10,
  });
});

test("blocks critical risk despite an AI continue recommendation", () => {
  const result = evaluate(
    createRequest(),
    createIntelligenceResult({
      advisoryDecision: "CONTINUE",
      riskScore: 95,
      riskLevel: "CRITICAL",
      advisoryDeployment: {
        strategy: "STANDARD",
        initialTrafficPercent: 100,
      },
    }),
  );

  assert.equal(
    result.decision,
    "BLOCK",
  );

  assert.deepEqual(
    result.policyOverrides,
    [
      "CRITICAL_RISK",
    ],
  );

  assert.deepEqual(result.deployment, {
    strategy: "BLOCKED",
    initialTrafficPercent: 0,
  });

  assert.ok(
    result.requiredActions.includes(
      "Reduce or resolve the critical release risk before deployment.",
    ),
  );
});

test("unknown tests raise the risk floor without automatically blocking", () => {
  const result = evaluate(
    createRequest("unknown"),
    createIntelligenceResult({
      riskScore: 5,
      riskLevel: "LOW",
    }),
  );

  assert.equal(
    result.decision,
    "CONTINUE",
  );

  assert.deepEqual(result.risk, {
    score: 70,
    level: "HIGH",
  });

  assert.deepEqual(result.deployment, {
    strategy: "CANARY",
    initialTrafficPercent: 5,
  });

  assert.deepEqual(
    result.policyOverrides,
    [],
  );
});

test("maps intelligence findings into the public response", () => {
  const result = evaluate(
    createRequest(),
    createIntelligenceResult({
      riskScore: 45,
      riskLevel: "MEDIUM",
      findings: [
        {
          category: "RELIABILITY",
          severity: "MEDIUM",
          title: "Possible retry weakness",
          explanation:
            "The changed operation may need bounded retries.",
          file: null,
        },
      ],
    }),
  );

  assert.deepEqual(
    result.findings[0],
    {
      code:
        "INTELLIGENCE_RELIABILITY_1",
      source: "INTELLIGENCE",
      severity: "MEDIUM",
      title: "Possible retry weakness",
      explanation:
        "The changed operation may need bounded retries.",
    },
  );
});
