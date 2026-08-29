import type {
  CiConclusion,
  CiEvidenceDto,
} from "../../dto/ci-evidence.js";
import {
  parseCiInvestigation,
} from "../../dto/ci-investigation.js";
import type {
  CiInvestigationDto,
} from "../../dto/ci-investigation.js";

const failedConclusions = new Set<
  CiConclusion
>([
  "failure",
  "timed_out",
  "action_required",
  "startup_failure",
]);

const incompleteConclusions = new Set<
  CiConclusion
>([
  "neutral",
  "cancelled",
  "skipped",
  "stale",
]);

export interface CiInvestigator {
  investigate(
    evidence: CiEvidenceDto,
  ): CiInvestigationDto;
}

function classifyConclusion(
  conclusion: CiConclusion,
): "PASSED" | "FAILED" | "INCOMPLETE" {
  if (failedConclusions.has(conclusion)) {
    return "FAILED";
  }

  if (
    incompleteConclusions.has(
      conclusion,
    )
  ) {
    return "INCOMPLETE";
  }

  return "PASSED";
}

function freezeInvestigation(
  investigation: CiInvestigationDto,
): CiInvestigationDto {
  for (const job of
    investigation.problemJobs) {
    for (const step of job.problemSteps) {
      Object.freeze(step);
    }

    Object.freeze(job.problemSteps);
    Object.freeze(job);
  }

  Object.freeze(
    investigation.problemJobs,
  );
  Object.freeze(investigation.summary);

  return Object.freeze(investigation);
}

export class DefaultCiInvestigator
implements CiInvestigator {
  investigate(
    evidence: CiEvidenceDto,
  ): CiInvestigationDto {
    let failedJobs = 0;
    let incompleteJobs = 0;
    let failedSteps = 0;
    let incompleteSteps = 0;

    const problemJobs =
      evidence.jobs.flatMap((job) => {
        const jobOutcome =
          classifyConclusion(
            job.conclusion,
          );

        if (jobOutcome === "FAILED") {
          failedJobs += 1;
        } else if (
          jobOutcome === "INCOMPLETE"
        ) {
          incompleteJobs += 1;
        }

        const problemSteps =
          job.steps.flatMap((step) => {
            const stepOutcome =
              classifyConclusion(
                step.conclusion,
              );

            if (stepOutcome === "FAILED") {
              failedSteps += 1;
            } else if (
              stepOutcome
              === "INCOMPLETE"
            ) {
              incompleteSteps += 1;
            }

            if (stepOutcome === "PASSED") {
              return [];
            }

            return [
              {
                number: step.number,
                name: step.name,
                conclusion:
                  step.conclusion,
              },
            ];
          });

        if (
          jobOutcome === "PASSED"
          && problemSteps.length === 0
        ) {
          return [];
        }

        return [
          {
            jobId: job.jobId,
            name: job.name,
            conclusion: job.conclusion,
            problemSteps,
          },
        ];
      });

    const workflowOutcome =
      classifyConclusion(
        evidence.conclusion,
      );

    const outcome =
      workflowOutcome === "FAILED"
      || failedJobs > 0
        ? "FAILED"
        : workflowOutcome
            === "INCOMPLETE"
          || incompleteJobs > 0
          ? "INCOMPLETE"
          : "PASSED";

    const investigation =
      parseCiInvestigation({
        provider: evidence.provider,
        workflowName:
          evidence.workflowName,
        runId: evidence.runId,
        runAttempt:
          evidence.runAttempt,
        conclusion:
          evidence.conclusion,
        outcome,
        summary: {
          totalJobs:
            evidence.jobs.length,
          failedJobs,
          incompleteJobs,
          failedSteps,
          incompleteSteps,
        },
        problemJobs,
      });

    return freezeInvestigation(
      investigation,
    );
  }
}
