import type {
  CiEvidenceDto,
} from "../dto/ci-evidence.js";
import type {
  TestStatus,
} from "../dto/review-request.js";
import type {
  ReviewController,
} from "../controllers/review-controller.js";
import {
  HttpError,
} from "../middleware/http-error.js";
import type {
  GitHubCheckRunPublisher,
  GitHubCiEvidenceCollector,
  GitHubPullRequestChangeCollector,
} from "./github-api-client.js";
import type {
  EnabledGitHubAutomationConfig,
} from "./github-automation-config.js";
import {
  parseGitHubWorkflowRunTask,
} from "./github-workflow-task.js";
import type {
  GitHubWorkflowRunTask,
  GitHubWorkflowRunTaskDispatcher,
} from "./github-workflow-task.js";

const testStepPattern =
  /\b(?:test|tests|jest|vitest|pytest|specs?)\b/iu;

export interface GitHubWorkflowRunProcessor {
  process(
    task: GitHubWorkflowRunTask,
  ): Promise<void>;
}

export interface GitHubWorkflowAutomationLogger {
  completed(input: {
    readonly deliveryId: string;
    readonly repository: string;
    readonly workflowRunId: number;
    readonly reviewId: string;
    readonly decision: "CONTINUE" | "BLOCK";
    readonly checkRunId: number;
  }): void;
  failed(input: {
    readonly deliveryId: string;
    readonly repository: string;
    readonly workflowRunId: number;
    readonly errorCode: string;
  }): void;
}

const defaultLogger:
  GitHubWorkflowAutomationLogger = {
    completed: (input) => {
      console.log(JSON.stringify({
        telemetryEvent:
          "canaryguard.github.automation.completed",
        ...input,
      }));
    },
    failed: (input) => {
      console.error(JSON.stringify({
        telemetryEvent:
          "canaryguard.github.automation.failed",
        ...input,
      }));
    },
  };

function deriveTestStatus(
  ci: CiEvidenceDto,
): TestStatus {
  const testSteps = ci.jobs.flatMap(
    (job) => job.steps.filter(
      (step) =>
        testStepPattern.test(step.name),
    ),
  );

  if (
    testSteps.some(
      (step) =>
        step.conclusion === "failure",
    )
  ) {
    return "failed";
  }

  if (
    testSteps.some(
      (step) =>
        step.conclusion === "success",
    )
  ) {
    return "passed";
  }

  return "unknown";
}

export interface DefaultGitHubWorkflowRunProcessorOptions {
  readonly evidenceCollector:
    GitHubCiEvidenceCollector;
  readonly changeCollector:
    GitHubPullRequestChangeCollector;
  readonly reviewController:
    ReviewController;
  readonly checkRunPublisher:
    GitHubCheckRunPublisher;
  readonly logger?:
    GitHubWorkflowAutomationLogger;
}

export class DefaultGitHubWorkflowRunProcessor
implements GitHubWorkflowRunProcessor {
  private readonly evidenceCollector:
    GitHubCiEvidenceCollector;

  private readonly changeCollector:
    GitHubPullRequestChangeCollector;

  private readonly reviewController:
    ReviewController;

  private readonly checkRunPublisher:
    GitHubCheckRunPublisher;

  private readonly logger:
    GitHubWorkflowAutomationLogger;

  constructor(
    options:
      DefaultGitHubWorkflowRunProcessorOptions,
  ) {
    this.evidenceCollector =
      options.evidenceCollector;
    this.changeCollector =
      options.changeCollector;
    this.reviewController =
      options.reviewController;
    this.checkRunPublisher =
      options.checkRunPublisher;
    this.logger = options.logger
      ?? defaultLogger;
  }

  async process(
    input: GitHubWorkflowRunTask,
  ): Promise<void> {
    const task =
      parseGitHubWorkflowRunTask(input);

    const [ci, change] =
      await Promise.all([
        this.evidenceCollector.collect({
          repository: task.repository,
          runId: task.workflowRun.id,
          expectedHeadSha:
            task.workflowRun.headSha,
          expectedRunAttempt:
            task.workflowRun.runAttempt,
          expectedInstallationId:
            task.installationId,
        }),
        this.changeCollector.collectPullRequestChange({
          repository: task.repository,
          pullRequestNumber:
            task.pullRequest.number,
          expectedHeadSha:
            task.workflowRun.headSha,
          expectedInstallationId:
            task.installationId,
        }),
      ]);

    const review =
      await this.reviewController
        .createReview({
          repository: task.repository,
          change,
          evidence: {
            testStatus:
              deriveTestStatus(ci),
            securityFindings: [],
            ci,
          },
        });

    const publication =
      await this.checkRunPublisher
        .publishCheckRun({
          repository: task.repository,
          expectedInstallationId:
            task.installationId,
          workflowRunId:
            task.workflowRun.id,
          runAttempt:
            task.workflowRun.runAttempt,
          headSha:
            task.workflowRun.headSha,
          review,
        });

    this.logger.completed({
      deliveryId: task.deliveryId,
      repository:
        `${task.repository.owner}/${task.repository.name}`,
      workflowRunId:
        task.workflowRun.id,
      reviewId: review.reviewId,
      decision: review.decision,
      checkRunId:
        publication.checkRunId,
    });
  }
}

export interface InMemoryGitHubWorkflowRunQueueOptions {
  readonly processor:
    GitHubWorkflowRunProcessor;
  readonly logger?:
    GitHubWorkflowAutomationLogger;
  readonly schedule?: (
    callback: () => void,
  ) => void;
}

export class InMemoryGitHubWorkflowRunQueue
implements GitHubWorkflowRunTaskDispatcher {
  private readonly capacity: number;

  private readonly concurrency: number;

  private readonly processor:
    GitHubWorkflowRunProcessor;

  private readonly logger:
    GitHubWorkflowAutomationLogger;

  private readonly schedule: (
    callback: () => void,
  ) => void;

  private readonly pending:
    GitHubWorkflowRunTask[] = [];

  private active = 0;

  private scheduled = false;

  constructor(
    config: EnabledGitHubAutomationConfig,
    options:
      InMemoryGitHubWorkflowRunQueueOptions,
  ) {
    this.capacity =
      config.queueCapacity;
    this.concurrency =
      config.concurrency;
    this.processor = options.processor;
    this.logger = options.logger
      ?? defaultLogger;
    this.schedule = options.schedule
      ?? ((callback) => {
        setImmediate(callback);
      });
  }

  dispatch(
    input: GitHubWorkflowRunTask,
  ): void {
    const task =
      parseGitHubWorkflowRunTask(input);

    if (
      this.pending.length + this.active
      >= this.capacity
    ) {
      throw new HttpError({
        statusCode: 503,
        code:
          "GITHUB_AUTOMATION_QUEUE_CAPACITY_EXCEEDED",
        message:
          "GitHub workflow automation is temporarily at capacity.",
        expose: false,
      });
    }

    this.pending.push(task);
    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.scheduled) {
      return;
    }

    this.scheduled = true;

    this.schedule(() => {
      this.scheduled = false;
      this.drain();
    });
  }

  private drain(): void {
    while (
      this.active < this.concurrency
      && this.pending.length > 0
    ) {
      const task = this.pending.shift();

      if (task === undefined) {
        break;
      }

      this.active += 1;

      void this.processor.process(task)
        .catch((error: unknown) => {
          this.logger.failed({
            deliveryId:
              task.deliveryId,
            repository:
              `${task.repository.owner}/${task.repository.name}`,
            workflowRunId:
              task.workflowRun.id,
            errorCode:
              error instanceof HttpError
                ? error.code
                : "GITHUB_AUTOMATION_FAILED",
          });
        })
        .finally(() => {
          this.active -= 1;
          this.scheduleDrain();
        });
    }
  }
}
