import type {
  ReviewRequestDto,
} from "../../dto/review-request.js";
import type {
  CiInvestigationDto,
} from "../../dto/ci-investigation.js";
import type {
  ReviewRiskLevel,
} from "../../dto/review-response.js";
import type {
  AxeEvidenceFindingDto,
  AxeEvidenceReportDto,
  ExternalEvidenceAttribution,
  ExternalEvidenceReportDto,
  Phase7EvidenceFindingDto,
  Phase7EvidenceReportDto,
  TrivyEvidenceFindingDto,
  TrivyEvidenceReportDto,
} from "../../dto/external-evidence.js";
import {
  DefaultCiInvestigator,
} from "../ci/ci-investigator.js";
import type {
  CiInvestigator,
} from "../ci/ci-investigator.js";

export interface DeterministicFinding {
  readonly code: string;
  readonly source: "DETERMINISTIC";
  readonly severity: ReviewRiskLevel;
  readonly title: string;
  readonly explanation: string;
  readonly file?: string;
  readonly blocking: boolean;
  readonly attribution?:
    ExternalEvidenceAttribution;
}

function createAxeFinding(
  report: AxeEvidenceReportDto,
  finding: AxeEvidenceFindingDto,
): DeterministicFinding {
  return Object.freeze({
    code:
      `AXE_${finding.category}_${finding.severity}`,
    source: "DETERMINISTIC",
    severity: finding.severity,
    title: finding.title,
    explanation:
      `Finding ${finding.identifier} was normalized by Axe adapter ${report.adapterVersion} from axe-core ${report.scannerVersion}.`,
    file: finding.pagePath,
    blocking:
      finding.severity === "CRITICAL",
    attribution: Object.freeze({
      source: report.source,
      sourceVersion:
        report.adapterVersion,
      identifier: finding.identifier,
      category: finding.category,
      generatedAt: report.generatedAt,
    }),
  });
}

export interface DeterministicAssessment {
  readonly findings: readonly DeterministicFinding[];
  readonly blockingRuleCodes: readonly string[];
  readonly ciInvestigation?:
    CiInvestigationDto;
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

function createTrivyFinding(
  report: TrivyEvidenceReportDto,
  finding: TrivyEvidenceFindingDto,
): DeterministicFinding {
  return Object.freeze({
    code:
      `TRIVY_${finding.category}_${finding.severity}`,
    source: "DETERMINISTIC",
    severity: finding.severity,
    title: finding.title,
    explanation:
      `Finding ${finding.identifier} was normalized by Trivy adapter ${report.adapterVersion}.`,
    ...(finding.file === undefined
      ? {}
      : {
          file: finding.file,
        }),
    blocking:
      finding.severity === "CRITICAL",
    attribution: Object.freeze({
      source: report.source,
      sourceVersion:
        report.adapterVersion,
      identifier: finding.identifier,
      category: finding.category,
      generatedAt: report.generatedAt,
    }),
  });
}

function createTruncatedEvidenceFinding(
  report: TrivyEvidenceReportDto,
): DeterministicFinding {
  return Object.freeze({
    code: "TRIVY_EVIDENCE_TRUNCATED",
    source: "DETERMINISTIC",
    severity: "HIGH",
    title:
      "Trivy evidence exceeded the reporting boundary",
    explanation:
      `Trivy adapter ${report.adapterVersion} retained only the bounded finding set for ${report.scanTarget}.`,
    blocking: false,
  });
}

function createTruncatedAxeEvidenceFinding(
  report: AxeEvidenceReportDto,
): DeterministicFinding {
  return Object.freeze({
    code: "AXE_EVIDENCE_TRUNCATED",
    source: "DETERMINISTIC",
    severity: "HIGH",
    title:
      "Accessibility evidence exceeded the reporting boundary",
    explanation:
      `Axe adapter ${report.adapterVersion} retained only the bounded finding set for ${report.pagePath}.`,
    file: report.pagePath,
    blocking: false,
  });
}

function createPhase7Finding(
  report: Phase7EvidenceReportDto,
  finding: Phase7EvidenceFindingDto,
): DeterministicFinding {
  return Object.freeze({
    code: `${report.source}_${finding.category}_${finding.severity}`,
    source: "DETERMINISTIC",
    severity: finding.severity,
    title: finding.title,
    explanation:
      `Finding ${finding.identifier} was normalized by ${report.source} adapter ${report.adapterVersion} from scanner ${report.scannerVersion}.`,
    ...(finding.resource === undefined
      ? {}
      : { file: finding.resource }),
    blocking: finding.severity === "CRITICAL",
    attribution: Object.freeze({
      source: report.source,
      sourceVersion: report.adapterVersion,
      identifier: finding.identifier,
      category: finding.category,
      generatedAt: report.generatedAt,
    }),
  });
}

function createTruncatedPhase7EvidenceFinding(
  report: Phase7EvidenceReportDto,
): DeterministicFinding {
  return Object.freeze({
    code: `${report.source}_EVIDENCE_TRUNCATED`,
    source: "DETERMINISTIC",
    severity: "HIGH",
    title: "External evidence exceeded the reporting boundary",
    explanation:
      `${report.source} adapter ${report.adapterVersion} retained only the bounded finding set for ${report.scanTarget}.`,
    blocking: false,
  });
}

function appendExternalEvidenceFindings(
  findings: DeterministicFinding[],
  report: ExternalEvidenceReportDto,
): void {
  if (report.source === "TRIVY") {
    for (const finding of report.findings) {
      findings.push(
        createTrivyFinding(
          report,
          finding,
        ),
      );
    }

    if (report.truncated) {
      findings.push(
        createTruncatedEvidenceFinding(
          report,
        ),
      );
    }

    return;
  }

  if (report.source !== "AXE") {
    for (const finding of report.findings) {
      findings.push(createPhase7Finding(report, finding));
    }

    if (report.truncated) {
      findings.push(createTruncatedPhase7EvidenceFinding(report));
    }

    return;
  }

  for (const finding of report.findings) {
    findings.push(
      createAxeFinding(
        report,
        finding,
      ),
    );
  }

  if (report.truncated) {
    findings.push(
      createTruncatedAxeEvidenceFinding(
        report,
      ),
    );
  }
}

function createCiFinding(
  investigation: CiInvestigationDto,
): DeterministicFinding | undefined {
  if (investigation.outcome === "PASSED") {
    return undefined;
  }

  if (investigation.outcome === "FAILED") {
    return Object.freeze({
      code: "CI_FAILED",
      source: "DETERMINISTIC",
      severity: "CRITICAL",
      title:
        "GitHub Actions reported a CI failure",
      explanation:
        `Workflow ${investigation.workflowName} run ${investigation.runId} attempt ${investigation.runAttempt} reported ${investigation.summary.failedJobs} failed job(s) and ${investigation.summary.failedSteps} failed step(s).`,
      blocking: true,
    });
  }

  return Object.freeze({
    code: "CI_INCOMPLETE",
    source: "DETERMINISTIC",
    severity: "HIGH",
    title:
      "GitHub Actions evidence is incomplete",
    explanation:
      `Workflow ${investigation.workflowName} run ${investigation.runId} attempt ${investigation.runAttempt} did not produce a successful or failed terminal result.`,
    blocking: false,
  });
}

export class DefaultDeterministicEngine
implements DeterministicEngine {
  private readonly ciInvestigator:
    CiInvestigator;

  constructor(
    ciInvestigator: CiInvestigator =
      new DefaultCiInvestigator(),
  ) {
    this.ciInvestigator = ciInvestigator;
  }

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

    for (
      const report
      of request.evidence.externalEvidence
    ) {
      appendExternalEvidenceFindings(
        findings,
        report,
      );
    }

    const ciInvestigation =
      request.evidence.ci === undefined
        ? undefined
        : this.ciInvestigator.investigate(
            request.evidence.ci,
          );

    if (ciInvestigation !== undefined) {
      const ciFinding = createCiFinding(
        ciInvestigation,
      );

      if (ciFinding !== undefined) {
        findings.push(ciFinding);
      }
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
      ...(
        ciInvestigation === undefined
          ? {}
          : {
              ciInvestigation,
            }
      ),
    });
  }
}
