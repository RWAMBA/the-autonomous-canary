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
import {
  DefaultDeterministicEngine,
} from "../../src/engines/deterministic/deterministic-engine.js";

type TestStatus =
  | "passed"
  | "failed"
  | "unknown";

type SecuritySeverity =
  | "low"
  | "medium"
  | "high"
  | "critical";

interface SecurityFindingInput {
  readonly identifier: string;
  readonly source: string;
  readonly severity: SecuritySeverity;
  readonly title: string;
  readonly file?: string;
}

interface RequestOptions {
  readonly testStatus?: TestStatus;
  readonly securityFindings?:
    readonly SecurityFindingInput[];
  readonly ci?: CiEvidenceDto;
}

function createCiEvidence(
  conclusion:
    | "success"
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

function createRequest(
  options: RequestOptions = {},
) {
  return parseReviewRequest({
    repository: {
      owner: "RWAMBA",
      name: "the-autonomous-canary",
    },
    change: {
      title: "Review a candidate release",
      baseSha: "abcdef1234567890",
      headSha: "1234567890abcdef",
      diff: "+export const enabled = true;",
    },
    evidence: {
      testStatus:
        options.testStatus ?? "passed",
      securityFindings:
        options.securityFindings ?? [],
      ...(
        options.ci === undefined
          ? {}
          : {
              ci: options.ci,
            }
      ),
    },
  });
}

test("returns no findings for clean passed evidence", () => {
  const engine = new DefaultDeterministicEngine();

  const assessment = engine.analyze(
    createRequest(),
  );

  assert.deepEqual(assessment.findings, []);
  assert.deepEqual(
    assessment.blockingRuleCodes,
    [],
  );
});

test("marks failed tests as critically blocking", () => {
  const engine = new DefaultDeterministicEngine();

  const assessment = engine.analyze(
    createRequest({
      testStatus: "failed",
    }),
  );

  assert.equal(assessment.findings.length, 1);

  const finding = assessment.findings[0];

  assert.ok(finding);
  assert.equal(finding.code, "TESTS_FAILED");
  assert.equal(
    finding.source,
    "DETERMINISTIC",
  );
  assert.equal(finding.severity, "CRITICAL");
  assert.equal(finding.blocking, true);
  assert.deepEqual(
    assessment.blockingRuleCodes,
    [
      "TESTS_FAILED",
    ],
  );
});

test("records unknown tests without automatically blocking", () => {
  const engine = new DefaultDeterministicEngine();

  const assessment = engine.analyze(
    createRequest({
      testStatus: "unknown",
    }),
  );

  const finding = assessment.findings[0];

  assert.ok(finding);
  assert.equal(
    finding.code,
    "TEST_STATUS_UNKNOWN",
  );
  assert.equal(finding.severity, "HIGH");
  assert.equal(finding.blocking, false);
  assert.deepEqual(
    assessment.blockingRuleCodes,
    [],
  );
});

test("marks a critical security finding as blocking", () => {
  const engine = new DefaultDeterministicEngine();

  const assessment = engine.analyze(
    createRequest({
      securityFindings: [
        {
          identifier: "CVE-EXAMPLE-0001",
          source: "Trivy",
          severity: "critical",
          title: "Critical remote code execution",
          file: "container/runtime",
        },
      ],
    }),
  );

  const finding = assessment.findings[0];

  assert.ok(finding);
  assert.equal(
    finding.code,
    "SECURITY_FINDING_CRITICAL",
  );
  assert.equal(finding.severity, "CRITICAL");
  assert.equal(finding.blocking, true);
  assert.equal(
    finding.file,
    "container/runtime",
  );
  assert.deepEqual(
    assessment.blockingRuleCodes,
    [
      "SECURITY_FINDING_CRITICAL",
    ],
  );
});

test("blocks failed GitHub Actions evidence even when aggregate tests say passed", () => {
  const engine = new DefaultDeterministicEngine();

  const assessment = engine.analyze(
    createRequest({
      testStatus: "passed",
      ci: createCiEvidence("failure"),
    }),
  );

  assert.equal(
    assessment.ciInvestigation?.outcome,
    "FAILED",
  );
  assert.equal(
    assessment.findings[0]?.code,
    "CI_FAILED",
  );
  assert.equal(
    assessment.findings[0]?.severity,
    "CRITICAL",
  );
  assert.deepEqual(
    assessment.blockingRuleCodes,
    [
      "CI_FAILED",
    ],
  );
});

test("raises the risk signal for incomplete CI without automatically blocking", () => {
  const engine = new DefaultDeterministicEngine();

  const assessment = engine.analyze(
    createRequest({
      ci: createCiEvidence("cancelled"),
    }),
  );

  assert.equal(
    assessment.ciInvestigation?.outcome,
    "INCOMPLETE",
  );
  assert.equal(
    assessment.findings[0]?.code,
    "CI_INCOMPLETE",
  );
  assert.equal(
    assessment.findings[0]?.severity,
    "HIGH",
  );
  assert.deepEqual(
    assessment.blockingRuleCodes,
    [],
  );
});

test("records successful CI without adding a finding", () => {
  const engine = new DefaultDeterministicEngine();

  const assessment = engine.analyze(
    createRequest({
      ci: createCiEvidence("success"),
    }),
  );

  assert.equal(
    assessment.ciInvestigation?.outcome,
    "PASSED",
  );
  assert.deepEqual(
    assessment.findings,
    [],
  );
});

test("maps noncritical security severities without blocking", () => {
  const engine = new DefaultDeterministicEngine();

  const assessment = engine.analyze(
    createRequest({
      securityFindings: [
        {
          identifier: "LOW-1",
          source: "Scanner",
          severity: "low",
          title: "Low finding",
        },
        {
          identifier: "MEDIUM-1",
          source: "Scanner",
          severity: "medium",
          title: "Medium finding",
        },
        {
          identifier: "HIGH-1",
          source: "Scanner",
          severity: "high",
          title: "High finding",
        },
      ],
    }),
  );

  assert.deepEqual(
    assessment.findings.map(
      (finding) => ({
        severity: finding.severity,
        blocking: finding.blocking,
      }),
    ),
    [
      {
        severity: "LOW",
        blocking: false,
      },
      {
        severity: "MEDIUM",
        blocking: false,
      },
      {
        severity: "HIGH",
        blocking: false,
      },
    ],
  );

  assert.deepEqual(
    assessment.blockingRuleCodes,
    [],
  );
});

test("deduplicates repeated blocking rule codes", () => {
  const engine = new DefaultDeterministicEngine();

  const assessment = engine.analyze(
    createRequest({
      securityFindings: [
        {
          identifier: "CRITICAL-1",
          source: "Scanner",
          severity: "critical",
          title: "First critical finding",
        },
        {
          identifier: "CRITICAL-2",
          source: "Scanner",
          severity: "critical",
          title: "Second critical finding",
        },
      ],
    }),
  );

  assert.equal(assessment.findings.length, 2);
  assert.deepEqual(
    assessment.blockingRuleCodes,
    [
      "SECURITY_FINDING_CRITICAL",
    ],
  );
});

test("freezes deterministic results", () => {
  const engine = new DefaultDeterministicEngine();

  const assessment = engine.analyze(
    createRequest({
      testStatus: "failed",
    }),
  );

  assert.equal(
    Object.isFrozen(assessment),
    true,
  );
  assert.equal(
    Object.isFrozen(assessment.findings),
    true,
  );
  assert.equal(
    Object.isFrozen(
      assessment.blockingRuleCodes,
    ),
    true,
  );

  const finding = assessment.findings[0];

  assert.ok(finding);
  assert.equal(
    Object.isFrozen(finding),
    true,
  );
});

test("does not modify the validated request", () => {
  const engine = new DefaultDeterministicEngine();
  const request = createRequest({
    testStatus: "failed",
    securityFindings: [
      {
        identifier: "HIGH-1",
        source: "Scanner",
        severity: "high",
        title: "High finding",
      },
    ],
  });

  const before = JSON.stringify(request);

  engine.analyze(request);

  assert.equal(
    JSON.stringify(request),
    before,
  );
});
