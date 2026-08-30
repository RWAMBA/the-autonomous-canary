import type {
  ReviewRequestDto,
} from "../../dto/review-request.js";
import {
  parseReviewResponse,
} from "../../dto/review-response.js";
import type {
  ReviewDecision,
  ReviewFinding,
  ReviewResponseDto,
  ReviewRiskLevel,
} from "../../dto/review-response.js";
import type {
  DeterministicAssessment,
  DeterministicFinding,
} from "../deterministic/deterministic-engine.js";
import type {
  IntelligenceFinding,
  IntelligenceResult,
} from "../intelligence/intelligence-engine.js";
import {
  buildCiDiagnostic,
} from "../ci/ci-diagnostic-builder.js";

export interface PolicyEvaluationInput {
  readonly reviewId: string;
  readonly request: ReviewRequestDto;
  readonly deterministicAssessment:
    DeterministicAssessment;
  readonly intelligenceResult:
    IntelligenceResult;
}

export interface PolicyEngine {
  evaluate(
    input: PolicyEvaluationInput,
  ): ReviewResponseDto;
}

const maximumResponseFindings = 200;
const maximumRequiredActions = 50;
const maximumPolicyOverrides = 50;

const riskFloorByLevel: Record<
  ReviewRiskLevel,
  number
> = {
  LOW: 10,
  MEDIUM: 40,
  HIGH: 70,
  CRITICAL: 90,
};

function uniqueStrings(
  values: readonly string[],
): string[] {
  return [
    ...new Set(values),
  ];
}

function mapDeterministicFinding(
  finding: DeterministicFinding,
): ReviewFinding {
  return {
    code: finding.code,
    source: "DETERMINISTIC",
    severity: finding.severity,
    title: finding.title,
    explanation: finding.explanation,
    ...(
      finding.file === undefined
        ? {}
        : {
            file: finding.file,
          }
    ),
  };
}

function mapIntelligenceFinding(
  finding: IntelligenceFinding,
  index: number,
): ReviewFinding {
  return {
    code:
      `INTELLIGENCE_${finding.category}_${index + 1}`,
    source: "INTELLIGENCE",
    severity: finding.severity,
    title: finding.title,
    explanation: finding.explanation,
    ...(
      finding.file === null
        ? {}
        : {
            file: finding.file,
          }
    ),
  };
}

function calculateRisk(
  deterministicAssessment:
    DeterministicAssessment,
  intelligenceResult:
    IntelligenceResult,
): {
  readonly score: number;
  readonly level: ReviewRiskLevel;
} {
  const deterministicRiskFloor =
    deterministicAssessment.findings.reduce(
      (highestFloor, finding) =>
        Math.max(
          highestFloor,
          riskFloorByLevel[finding.severity],
        ),
      0,
    );

  const intelligenceRiskFloor =
    riskFloorByLevel[
      intelligenceResult
        .assessment
        .riskLevel
    ];

  const score = Math.max(
    intelligenceResult.assessment.riskScore,
    intelligenceRiskFloor,
    deterministicRiskFloor,
  );

  if (score >= 90) {
    return {
      score,
      level: "CRITICAL",
    };
  }

  if (score >= 70) {
    return {
      score,
      level: "HIGH",
    };
  }

  if (score >= 40) {
    return {
      score,
      level: "MEDIUM",
    };
  }

  return {
    score,
    level: "LOW",
  };
}

function createPolicyOverrides(
  deterministicAssessment:
    DeterministicAssessment,
  intelligenceResult:
    IntelligenceResult,
  riskLevel: ReviewRiskLevel,
): string[] {
  if (
    intelligenceResult
      .assessment
      .advisoryDecision
    !== "CONTINUE"
  ) {
    return [];
  }

  if (
    deterministicAssessment
      .blockingRuleCodes
      .length > 0
  ) {
    return uniqueStrings(
      deterministicAssessment
        .blockingRuleCodes,
    ).slice(
      0,
      maximumPolicyOverrides,
    );
  }

  if (riskLevel === "CRITICAL") {
    return [
      "CRITICAL_RISK",
    ];
  }

  return [];
}

function createDecision(
  deterministicAssessment:
    DeterministicAssessment,
  intelligenceResult:
    IntelligenceResult,
  riskLevel: ReviewRiskLevel,
): ReviewDecision {
  if (
    deterministicAssessment
      .blockingRuleCodes
      .length > 0
  ) {
    return "BLOCK";
  }

  if (
    intelligenceResult
      .assessment
      .advisoryDecision
    === "BLOCK"
  ) {
    return "BLOCK";
  }

  if (riskLevel === "CRITICAL") {
    return "BLOCK";
  }

  return "CONTINUE";
}

function createDeployment(
  decision: ReviewDecision,
  riskLevel: ReviewRiskLevel,
): ReviewResponseDto["deployment"] {
  if (decision === "BLOCK") {
    return {
      strategy: "BLOCKED",
      initialTrafficPercent: 0,
    };
  }

  if (riskLevel === "HIGH") {
    return {
      strategy: "CANARY",
      initialTrafficPercent: 5,
    };
  }

  if (riskLevel === "MEDIUM") {
    return {
      strategy: "CANARY",
      initialTrafficPercent: 10,
    };
  }

  return {
    strategy: "STANDARD",
    initialTrafficPercent: 100,
  };
}

function createRequiredAction(
  code: string,
): string {
  if (code === "TESTS_FAILED") {
    return "Repair the failing automated tests and submit new evidence.";
  }

  if (
    code
    === "SECURITY_FINDING_CRITICAL"
  ) {
    return "Resolve every critical security finding before release.";
  }

  if (code === "CI_FAILED") {
    return "Repair the failed GitHub Actions jobs or steps and submit a completed successful run.";
  }

  if (code === "CRITICAL_RISK") {
    return "Reduce or resolve the critical release risk before deployment.";
  }

  return `Resolve the blocking policy rule ${code} before deployment.`;
}

function createPolicyFinding(
  policyOverrides: readonly string[],
): ReviewFinding | undefined {
  if (policyOverrides.length === 0) {
    return undefined;
  }

  return {
    code: "DETERMINISTIC_POLICY_OVERRIDE",
    source: "POLICY",
    severity: "CRITICAL",
    title:
      "Hard-coded release policy overrode the advisory decision",
    explanation:
      `The release was blocked by: ${policyOverrides.join(", ")}.`,
  };
}

export class DefaultPolicyEngine
implements PolicyEngine {
  evaluate(
    input: PolicyEvaluationInput,
  ): ReviewResponseDto {
    const risk = calculateRisk(
      input.deterministicAssessment,
      input.intelligenceResult,
    );

    const policyOverrides =
      createPolicyOverrides(
        input.deterministicAssessment,
        input.intelligenceResult,
        risk.level,
      );

    const decision = createDecision(
      input.deterministicAssessment,
      input.intelligenceResult,
      risk.level,
    );

    const deterministicFindings =
      input.deterministicAssessment
        .findings
        .map(mapDeterministicFinding);

    const intelligenceFindings =
      input.intelligenceResult
        .assessment
        .findings
        .map(mapIntelligenceFinding);

    const policyFinding =
      createPolicyFinding(
        policyOverrides,
      );

    const findings = [
      ...deterministicFindings,
      ...(
        policyFinding === undefined
          ? []
          : [
              policyFinding,
            ]
      ),
      ...intelligenceFindings,
    ].slice(
      0,
      maximumResponseFindings,
    );

    const policyActions =
      policyOverrides.map(
        createRequiredAction,
      );

    const requiredActions =
      uniqueStrings([
        ...policyActions,
        ...input.intelligenceResult
          .assessment
          .requiredActions,
      ]).slice(
        0,
        maximumRequiredActions,
      );

    const summary =
      policyOverrides.length === 0
        ? input.intelligenceResult
            .assessment
            .summary
        : `Release blocked by hard-coded policy: ${policyOverrides.join(", ")}.`;

    const ciDiagnostic =
      input.deterministicAssessment
        .ciInvestigation === undefined
        ? undefined
        : buildCiDiagnostic(
            input.request,
            input.deterministicAssessment
              .ciInvestigation,
            input.intelligenceResult
              .assessment
              .ciDiagnosis,
          );

    return parseReviewResponse({
      reviewId: input.reviewId,
      repository: {
        owner:
          input.request.repository.owner,
        name:
          input.request.repository.name,
      },
      headSha:
        input.request.change.headSha,
      decision,
      risk,
      summary,
      findings,
      requiredActions,
      policyOverrides,
      ...(
        input.deterministicAssessment
          .ciInvestigation
        === undefined
          ? {}
          : {
              ciInvestigation:
                input.deterministicAssessment
                  .ciInvestigation,
            }
      ),
      ...(
        ciDiagnostic === undefined
          ? {}
          : {
              ciDiagnostic,
            }
      ),
      deployment: createDeployment(
        decision,
        risk.level,
      ),
      analysis: {
        provider:
          input.intelligenceResult
            .telemetry
            .provider,
        modelTarget:
          input.intelligenceResult
            .telemetry
            .modelTarget,
        promptVersion:
          input.intelligenceResult
            .telemetry
            .promptVersion,
      },
    });
  }
}
