import type {
  AdvisoryCiDiagnosis,
  CiDiagnosticDto,
} from "../../dto/ci-diagnostic.js";
import {
  maximumCiDiagnosticEvidence,
  maximumCiDiagnosticFiles,
  parseCiDiagnostic,
} from "../../dto/ci-diagnostic.js";
import type {
  CiInvestigationDto,
} from "../../dto/ci-investigation.js";
import type {
  ReviewRequestDto,
} from "../../dto/review-request.js";

type FailureCategory =
  CiDiagnosticDto["failureCategory"];

interface DeterministicClassification {
  readonly failureCategory:
    FailureCategory;
  readonly confidence:
    CiDiagnosticDto["confidence"];
}

const categoryNamePatterns: readonly {
  readonly category: FailureCategory;
  readonly pattern: RegExp;
}[] = [
  {
    category: "SECURITY_SCAN_FAILURE",
    pattern:
      /\b(?:scan|security|codeql|trivy|snyk|secret[- ]?scan|vulnerabilit(?:y|ies))/i,
  },
  {
    category: "TYPE_CHECK_FAILURE",
    pattern:
      /\b(?:type[- ]?check|typescript|tsc)\b/i,
  },
  {
    category: "DEPENDENCY_FAILURE",
    pattern:
      /\b(?:dependenc(?:y|ies)|npm audit|npm ci|install dependencies|lockfile)\b/i,
  },
  {
    category: "BUILD_FAILURE",
    pattern:
      /\b(?:build|compile|dockerfile)\b/i,
  },
  {
    category: "TEST_FAILURE",
    pattern:
      /\b(?:test|tests|jest|vitest|pytest|specs?)\b/i,
  },
  {
    category: "INFRASTRUCTURE_FAILURE",
    pattern:
      /\b(?:runner|checkout|setup|network|service|infrastructure|deploy)\b/i,
  },
];

const categoryActions: Record<
  FailureCategory,
  readonly string[]
> = {
  TEST_FAILURE: [
    "Repair the failing tests or implementation, then submit a new completed CI run.",
  ],
  TYPE_CHECK_FAILURE: [
    "Correct the reported type errors, then rerun the type-check job.",
  ],
  BUILD_FAILURE: [
    "Repair the failed build step and verify that the production artifact can be created.",
  ],
  DEPENDENCY_FAILURE: [
    "Resolve the dependency installation, lockfile, or audit failure before rerunning CI.",
  ],
  SECURITY_SCAN_FAILURE: [
    "Review and resolve the reported security-scan findings before release approval.",
  ],
  INFRASTRUCTURE_FAILURE: [
    "Retry the workflow once; if the failure repeats, inspect the runner, network, and external service status.",
  ],
  FLAKY_OR_INCONCLUSIVE_FAILURE: [
    "Rerun the affected job once and compare the result before treating the failure as flaky.",
    "Require a terminal successful CI run before standard deployment.",
  ],
};

function classifyName(
  value: string,
): FailureCategory | undefined {
  const categories = new Set(
    categoryNamePatterns
      .filter(({ pattern }) => pattern.test(value))
      .map(({ category }) => category),
  );

  if (categories.size !== 1) {
    return undefined;
  }

  return categories.values().next().value;
}

function classifyDeterministically(
  investigation: CiInvestigationDto,
): DeterministicClassification | undefined {
  if (investigation.outcome === "INCOMPLETE") {
    return {
      failureCategory:
        "FLAKY_OR_INCONCLUSIVE_FAILURE",
      confidence: "HIGH",
    };
  }

  const stepCategories = new Set<
    FailureCategory
  >();

  for (const job of investigation.problemJobs) {
    for (const step of job.problemSteps) {
      const failureCategory = classifyName(
        step.name,
      );

      if (failureCategory !== undefined) {
        stepCategories.add(failureCategory);
      }
    }
  }

  if (stepCategories.size === 1) {
    const failureCategory =
      [...stepCategories][0];

    if (failureCategory === undefined) {
      return undefined;
    }

    return {
      failureCategory,
      confidence: "HIGH",
    };
  }

  if (stepCategories.size > 1) {
    return undefined;
  }

  const jobCategories = new Set<
    FailureCategory
  >();

  for (const job of investigation.problemJobs) {
    const failureCategory = classifyName(
      job.name,
    );

    if (failureCategory !== undefined) {
      jobCategories.add(failureCategory);
    }
  }

  if (jobCategories.size === 1) {
    const failureCategory =
      [...jobCategories][0];

    if (failureCategory === undefined) {
      return undefined;
    }

    return {
      failureCategory,
      confidence: "MEDIUM",
    };
  }

  if (jobCategories.size > 1) {
    return undefined;
  }

  if (
    investigation.conclusion === "startup_failure"
    || investigation.conclusion === "timed_out"
  ) {
    return {
      failureCategory:
        "INFRASTRUCTURE_FAILURE",
      confidence: "HIGH",
    };
  }

  return undefined;
}

function extractChangedFiles(
  diff: string,
): string[] {
  const files = new Set<string>();

  for (const line of diff.split("\n")) {
    if (!line.startsWith("+++ b/")) {
      continue;
    }

    const file = line.slice("+++ b/".length).trim();

    if (
      file.length > 0
      && file.length <= 500
      && file !== "/dev/null"
    ) {
      files.add(file);
    }

    if (files.size >= maximumCiDiagnosticFiles) {
      break;
    }
  }

  return [...files];
}

function selectRelevantChangedFiles(
  request: ReviewRequestDto,
  advisoryDiagnosis:
    AdvisoryCiDiagnosis | null,
): string[] {
  if (advisoryDiagnosis === null) {
    return [];
  }

  const changedFiles = new Set(
    extractChangedFiles(request.change.diff),
  );

  return [
    ...new Set(
      advisoryDiagnosis.relevantChangedFiles
        .filter((file) => changedFiles.has(file)),
    ),
  ].slice(0, maximumCiDiagnosticFiles);
}

function advisoryContainsRawLogContent(
  request: ReviewRequestDto,
  advisoryDiagnosis:
    AdvisoryCiDiagnosis,
): boolean {
  const advisoryText = [
    advisoryDiagnosis.probableCause,
    ...advisoryDiagnosis.recommendedActions,
  ].join("\n");

  for (const job of request.evidence.ci?.jobs ?? []) {
    for (const step of job.steps) {
      for (
        const rawLine
        of step.logExcerpt?.split("\n") ?? []
      ) {
        const line = rawLine.trim();

        if (line.length < 12) {
          continue;
        }

        if (line.length <= 32) {
          if (advisoryText.includes(line)) {
            return true;
          }

          continue;
        }

        for (
          let index = 0;
          index <= line.length - 32;
          index += 16
        ) {
          if (
            advisoryText.includes(
              line.slice(index, index + 32),
            )
          ) {
            return true;
          }
        }

        if (
          advisoryText.includes(
            line.slice(-32),
          )
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

function hasLogExcerpt(
  request: ReviewRequestDto,
  jobId: number,
  stepNumber: number,
): boolean {
  return request.evidence.ci?.jobs
    .find((job) => job.jobId === jobId)
    ?.steps
    .find((step) => step.number === stepNumber)
    ?.logExcerpt !== undefined;
}

function createSupportingEvidence(
  request: ReviewRequestDto,
  investigation: CiInvestigationDto,
): CiDiagnosticDto["supportingEvidence"] {
  const evidence:
    CiDiagnosticDto["supportingEvidence"] = [];

  for (const job of investigation.problemJobs) {
    if (job.problemSteps.length === 0) {
      evidence.push({
        jobName: job.name,
        stepName: null,
        conclusion: job.conclusion,
        logEvidenceAvailable: false,
      });
    } else {
      for (const step of job.problemSteps) {
        evidence.push({
          jobName: job.name,
          stepName: step.name,
          conclusion: step.conclusion,
          logEvidenceAvailable: hasLogExcerpt(
            request,
            job.jobId,
            step.number,
          ),
        });
      }
    }

    if (
      evidence.length
      >= maximumCiDiagnosticEvidence
    ) {
      break;
    }
  }

  evidence.splice(
    maximumCiDiagnosticEvidence,
  );

  if (evidence.length > 0) {
    return evidence;
  }

  return [
    {
      jobName: investigation.workflowName,
      stepName: null,
      conclusion: investigation.conclusion,
      logEvidenceAvailable: false,
    },
  ];
}

function createObservedCause(
  investigation: CiInvestigationDto,
  classification: DeterministicClassification,
): string {
  const problemJob = investigation.problemJobs[0];
  const problemStep = problemJob?.problemSteps[0];

  if (
    problemJob !== undefined
    && problemStep !== undefined
  ) {
    return `The ${problemStep.name} step in the ${problemJob.name} job reported ${problemStep.conclusion}.`;
  }

  if (problemJob !== undefined) {
    return `The ${problemJob.name} job reported ${problemJob.conclusion}.`;
  }

  if (
    classification.failureCategory
    === "FLAKY_OR_INCONCLUSIVE_FAILURE"
  ) {
    return "The workflow did not produce a complete successful or failed terminal result.";
  }

  return `The workflow reported ${investigation.conclusion} without a more specific failed job or step.`;
}

function retryRecommendationFor(
  failureCategory: FailureCategory,
): CiDiagnosticDto["retryRecommendation"] {
  if (failureCategory === "INFRASTRUCTURE_FAILURE") {
    return "RETRY";
  }

  if (
    failureCategory
    === "FLAKY_OR_INCONCLUSIVE_FAILURE"
  ) {
    return "MANUAL_REVIEW";
  }

  return "RETRY_AFTER_FIX";
}

function freezeDiagnostic(
  diagnostic: CiDiagnosticDto,
): CiDiagnosticDto {
  for (const evidence of diagnostic.supportingEvidence) {
    Object.freeze(evidence);
  }

  Object.freeze(diagnostic.relevantChangedFiles);
  Object.freeze(diagnostic.supportingEvidence);
  Object.freeze(diagnostic.recommendedActions);

  return Object.freeze(diagnostic);
}

export function buildCiDiagnostic(
  request: ReviewRequestDto,
  investigation: CiInvestigationDto,
  advisoryDiagnosis:
    AdvisoryCiDiagnosis | null,
): CiDiagnosticDto | undefined {
  if (investigation.outcome === "PASSED") {
    return undefined;
  }

  const deterministicClassification =
    classifyDeterministically(investigation);

  const useAdvisoryDiagnosis =
    deterministicClassification === undefined
    && advisoryDiagnosis !== null
    && !advisoryContainsRawLogContent(
      request,
      advisoryDiagnosis,
    );

  const fallbackClassification:
    DeterministicClassification = {
      failureCategory:
        "FLAKY_OR_INCONCLUSIVE_FAILURE",
      confidence: "LOW",
    };

  const classification =
    deterministicClassification
    ?? fallbackClassification;

  const failureCategory = useAdvisoryDiagnosis
    ? advisoryDiagnosis.failureCategory
    : classification.failureCategory;

  const diagnostic = parseCiDiagnostic({
    failureCategory,
    probableCause: useAdvisoryDiagnosis
      ? advisoryDiagnosis.probableCause
      : createObservedCause(
          investigation,
          classification,
        ),
    relevantChangedFiles:
      selectRelevantChangedFiles(
        request,
        useAdvisoryDiagnosis
          ? advisoryDiagnosis
          : null,
      ),
    supportingEvidence:
      createSupportingEvidence(
        request,
        investigation,
      ),
    confidence: useAdvisoryDiagnosis
      ? advisoryDiagnosis.confidence
      : classification.confidence,
    recommendedActions: useAdvisoryDiagnosis
      ? advisoryDiagnosis.recommendedActions
      : categoryActions[failureCategory],
    retryRecommendation: useAdvisoryDiagnosis
      ? advisoryDiagnosis.retryRecommendation
      : retryRecommendationFor(failureCategory),
    affectsReleaseApproval:
      investigation.outcome === "FAILED",
    classificationSource: useAdvisoryDiagnosis
      ? "INTELLIGENCE"
      : "DETERMINISTIC",
  });

  return freezeDiagnostic(diagnostic);
}
