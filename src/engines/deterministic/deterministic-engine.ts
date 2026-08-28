import type {
  ReviewRequestDto,
} from "../../dto/review-request.js";
import type {
  ReviewRiskLevel,
} from "../../dto/review-response.js";

export interface DeterministicFinding {
  readonly code: string;
  readonly source: "DETERMINISTIC";
  readonly severity: ReviewRiskLevel;
  readonly title: string;
  readonly explanation: string;
  readonly file?: string;
  readonly blocking: boolean;
}

export interface DeterministicAssessment {
  readonly findings: readonly DeterministicFinding[];
  readonly blockingRuleCodes: readonly string[];
}

export interface DeterministicEngine {
  analyze(
    request: ReviewRequestDto,
  ): DeterministicAssessment;
}

type SecuritySeverity =
  ReviewRequestDto[
    "evidence"
  ][
    "securityFindings"
  ][number]["severity"];

const securitySeverityMap: Record<
  SecuritySeverity,
  ReviewRiskLevel
> = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
  critical: "CRITICAL",
};

function createTestFinding(
  testStatus: ReviewRequestDto[
    "evidence"
  ]["testStatus"],
): DeterministicFinding | undefined {
  if (testStatus === "passed") {
    return undefined;
  }

  if (testStatus === "failed") {
    return Object.freeze({
      code: "TESTS_FAILED",
      source: "DETERMINISTIC",
      severity: "CRITICAL",
      title: "Automated tests failed",
      explanation:
        "The submitted release evidence reports that automated tests failed.",
      blocking: true,
    });
  }

  return Object.freeze({
    code: "TEST_STATUS_UNKNOWN",
    source: "DETERMINISTIC",
    severity: "HIGH",
    title: "Automated test status is unknown",
    explanation:
      "The submitted release evidence does not confirm that automated tests passed.",
    blocking: false,
  });
}

function createSecurityFinding(
  finding: ReviewRequestDto[
    "evidence"
  ][
    "securityFindings"
  ][number],
): DeterministicFinding {
  const severity =
    securitySeverityMap[finding.severity];

  return Object.freeze({
    code: `SECURITY_FINDING_${severity}`,
    source: "DETERMINISTIC",
    severity,
    title: finding.title,
    explanation:
      `Finding ${finding.identifier} was reported by ${finding.source}.`,
    ...(
      finding.file === undefined
        ? {}
        : {
            file: finding.file,
          }
    ),
    blocking: severity === "CRITICAL",
  });
}

export class DefaultDeterministicEngine
implements DeterministicEngine {
  analyze(
    request: ReviewRequestDto,
  ): DeterministicAssessment {
    const findings: DeterministicFinding[] = [];

    const testFinding = createTestFinding(
      request.evidence.testStatus,
    );

    if (testFinding !== undefined) {
      findings.push(testFinding);
    }

    for (
      const securityFinding
      of request.evidence.securityFindings
    ) {
      findings.push(
        createSecurityFinding(securityFinding),
      );
    }

    const blockingRuleCodes = [
      ...new Set(
        findings
          .filter((finding) => finding.blocking)
          .map((finding) => finding.code),
      ),
    ];

    return Object.freeze({
      findings: Object.freeze(findings),
      blockingRuleCodes:
        Object.freeze(blockingRuleCodes),
    });
  }
}
