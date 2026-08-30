import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import type {
  AdvisoryCiDiagnosis,
} from "../../src/dto/ci-diagnostic.js";
import {
  parseReviewRequest,
} from "../../src/dto/review-request.js";
import {
  buildCiDiagnostic,
} from "../../src/engines/ci/ci-diagnostic-builder.js";
import {
  DefaultCiInvestigator,
} from "../../src/engines/ci/ci-investigator.js";

type CiConclusion =
  "success"
  | "failure"
  | "cancelled"
  | "startup_failure";

function createRequest(
  options: {
    readonly workflowConclusion?:
      CiConclusion;
    readonly jobConclusion?:
      CiConclusion;
    readonly stepConclusion?:
      CiConclusion;
    readonly jobName?: string;
    readonly stepName?: string;
    readonly includeLog?: boolean;
  } = {},
) {
  const workflowConclusion =
    options.workflowConclusion ?? "failure";
  const jobConclusion =
    options.jobConclusion ?? workflowConclusion;
  const stepConclusion =
    options.stepConclusion ?? jobConclusion;

  return parseReviewRequest({
    repository: {
      owner: "RWAMBA",
      name: "the-autonomous-canary",
    },
    change: {
      title: "Diagnose CI",
      baseSha: "d16cd35",
      headSha: "f50aeca",
      diff: [
        "diff --git a/src/app.ts b/src/app.ts",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "+export const changed = true;",
        "diff --git a/README.md b/README.md",
        "--- a/README.md",
        "+++ b/README.md",
        "+Document the change.",
      ].join("\n"),
    },
    evidence: {
      testStatus: "passed",
      securityFindings: [],
      ci: {
        provider: "GITHUB_ACTIONS",
        workflowName:
          "Continuous Integration",
        runId: 33_280_424_277,
        runAttempt: 1,
        conclusion: workflowConclusion,
        jobs: [
          {
            jobId: 101,
            name: options.jobName
              ?? "quality",
            conclusion: jobConclusion,
            steps: [
              {
                number: 10,
                name: options.stepName
                  ?? "Test",
                conclusion: stepConclusion,
                ...(
                  options.includeLog === false
                    ? {}
                    : {
                        logExcerpt:
                          "Error: secret data must not be returned",
                      }
                ),
              },
            ],
          },
        ],
      },
    },
  });
}

function investigate(
  request: ReturnType<
    typeof createRequest
  >,
) {
  assert.ok(request.evidence.ci);

  return new DefaultCiInvestigator()
    .investigate(request.evidence.ci);
}

test("classifies named failed steps deterministically", () => {
  const cases = [
    ["Test", "TEST_FAILURE"],
    ["Type-check", "TYPE_CHECK_FAILURE"],
    ["Build", "BUILD_FAILURE"],
    ["Install dependencies", "DEPENDENCY_FAILURE"],
    ["Scan container image", "SECURITY_SCAN_FAILURE"],
  ] as const;

  for (const [stepName, failureCategory] of cases) {
    const request = createRequest({ stepName });
    const result = buildCiDiagnostic(
      request,
      investigate(request),
      null,
    );

    assert.equal(
      result?.failureCategory,
      failureCategory,
    );
    assert.equal(
      result?.classificationSource,
      "DETERMINISTIC",
    );
    assert.equal(
      result?.affectsReleaseApproval,
      true,
    );
    assert.equal(
      result?.retryRecommendation,
      "RETRY_AFTER_FIX",
    );
  }
});

test("returns bounded evidence references without returning log content", () => {
  const request = createRequest();
  const result = buildCiDiagnostic(
    request,
    investigate(request),
    null,
  );

  assert.deepEqual(
    result?.supportingEvidence,
    [
      {
        jobName: "quality",
        stepName: "Test",
        conclusion: "failure",
        logEvidenceAvailable: true,
      },
    ],
  );
  assert.equal(
    JSON.stringify(result).includes(
      "secret data",
    ),
    false,
  );
});

test("uses an advisory diagnosis only when deterministic names are ambiguous", () => {
  const request = createRequest({
    jobName: "quality",
    stepName: "Execute phase",
  });
  const advisoryDiagnosis:
    AdvisoryCiDiagnosis = {
      failureCategory: "BUILD_FAILURE",
      probableCause:
        "The build tool could not resolve an imported module.",
      relevantChangedFiles: [
        "src/app.ts",
        "not-in-the-diff.ts",
      ],
      confidence: "MEDIUM",
      recommendedActions: [
        "Correct the module import.",
      ],
      retryRecommendation:
        "RETRY_AFTER_FIX",
    };

  const result = buildCiDiagnostic(
    request,
    investigate(request),
    advisoryDiagnosis,
  );

  assert.equal(
    result?.classificationSource,
    "INTELLIGENCE",
  );
  assert.equal(
    result?.failureCategory,
    "BUILD_FAILURE",
  );
  assert.deepEqual(
    result?.relevantChangedFiles,
    [
      "src/app.ts",
    ],
  );
  assert.equal(
    result?.probableCause,
    advisoryDiagnosis.probableCause,
  );
});

test("delegates a composite job name instead of selecting its first keyword", () => {
  const request = createRequest({
    jobName: "Type-check, test, and build",
    stepName: "Execute phase",
  });
  const result = buildCiDiagnostic(
    request,
    investigate(request),
    {
      failureCategory: "BUILD_FAILURE",
      probableCause:
        "The build phase could not resolve a module.",
      relevantChangedFiles: [],
      confidence: "MEDIUM",
      recommendedActions: [
        "Inspect the failed phase before rerunning CI.",
      ],
      retryRecommendation:
        "RETRY_AFTER_FIX",
    },
  );

  assert.equal(
    result?.classificationSource,
    "INTELLIGENCE",
  );
  assert.equal(
    result?.failureCategory,
    "BUILD_FAILURE",
  );
});

test("does not let advisory output replace an objective named failure", () => {
  const request = createRequest({
    stepName: "Test",
  });

  const result = buildCiDiagnostic(
    request,
    investigate(request),
    {
      failureCategory:
        "INFRASTRUCTURE_FAILURE",
      probableCause: "Unsupported claim.",
      relevantChangedFiles: [
        "src/app.ts",
      ],
      confidence: "HIGH",
      recommendedActions: [
        "Ignore the failed tests.",
      ],
      retryRecommendation: "RETRY",
    },
  );

  assert.equal(
    result?.classificationSource,
    "DETERMINISTIC",
  );
  assert.equal(
    result?.failureCategory,
    "TEST_FAILURE",
  );
  assert.deepEqual(
    result?.relevantChangedFiles,
    [],
  );
  assert.equal(
    result?.probableCause.includes(
      "Test step",
    ),
    true,
  );
});

test("rejects an advisory diagnosis that reproduces raw log content", () => {
  const request = createRequest({
    jobName: "quality",
    stepName: "Execute phase",
  });
  const result = buildCiDiagnostic(
    request,
    investigate(request),
    {
      failureCategory: "BUILD_FAILURE",
      probableCause:
        "Error: secret data must not be returned",
      relevantChangedFiles: [],
      confidence: "HIGH",
      recommendedActions: [
        "Repair the build.",
      ],
      retryRecommendation:
        "RETRY_AFTER_FIX",
    },
  );

  assert.equal(
    result?.classificationSource,
    "DETERMINISTIC",
  );
  assert.equal(
    result?.failureCategory,
    "FLAKY_OR_INCONCLUSIVE_FAILURE",
  );
  assert.equal(
    JSON.stringify(result).includes(
      "secret data",
    ),
    false,
  );
});

test("classifies incomplete CI without blocking release approval", () => {
  const request = createRequest({
    workflowConclusion: "cancelled",
  });
  const result = buildCiDiagnostic(
    request,
    investigate(request),
    null,
  );

  assert.equal(
    result?.failureCategory,
    "FLAKY_OR_INCONCLUSIVE_FAILURE",
  );
  assert.equal(
    result?.retryRecommendation,
    "MANUAL_REVIEW",
  );
  assert.equal(
    result?.affectsReleaseApproval,
    false,
  );
});

test("classifies a workflow startup failure as infrastructure", () => {
  const request = createRequest({
    workflowConclusion:
      "startup_failure",
    jobConclusion: "success",
    stepConclusion: "success",
  });
  const result = buildCiDiagnostic(
    request,
    investigate(request),
    null,
  );

  assert.equal(
    result?.failureCategory,
    "INFRASTRUCTURE_FAILURE",
  );
  assert.equal(
    result?.retryRecommendation,
    "RETRY",
  );
});

test("returns no diagnostic for successful CI", () => {
  const request = createRequest({
    workflowConclusion: "success",
  });

  assert.equal(
    buildCiDiagnostic(
      request,
      investigate(request),
      null,
    ),
    undefined,
  );
});

test("freezes the complete diagnostic result", () => {
  const request = createRequest();
  const result = buildCiDiagnostic(
    request,
    investigate(request),
    null,
  );

  assert.ok(result);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(
    Object.isFrozen(
      result.supportingEvidence,
    ),
    true,
  );
  assert.equal(
    Object.isFrozen(
      result.supportingEvidence[0],
    ),
    true,
  );
  assert.equal(
    Object.isFrozen(
      result.recommendedActions,
    ),
    true,
  );
});
