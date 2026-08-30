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
  GitHubCheckRunPublication,
  GitHubCiEvidenceCollector,
  GitHubPullRequestChangeCollector,
} from "./github-api-client.js";
import type {
  GitHubLifecycleStore,
} from "../persistence/release-lifecycle-store.js";
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
  ): Promise<
    GitHubCheckRunPublication | void
  >;
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
  ): Promise<GitHubCheckRunPublication> {
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
        }, {
          ...(
            task.releaseId === undefined
              ? {}
              : {
                  releaseId:
                    task.releaseId,
                }
          ),
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

    return publication;
  }
}

export interface DurableGitHubWorkflowRunWorkerConfig {
  readonly concurrency: number;
  readonly pollIntervalMs: number;
  readonly leaseMs: number;
  readonly maximumAttempts: number;
  readonly retryBaseMs: number;
}

export interface DurableGitHubWorkflowRunWorkerOptions {
  readonly store:
    GitHubLifecycleStore;
  readonly processor:
    GitHubWorkflowRunProcessor;
  readonly logger?:
    GitHubWorkflowAutomationLogger;
  readonly clock?: () => Date;
}

export class DurableGitHubWorkflowRunWorker {
  private readonly config:
    DurableGitHubWorkflowRunWorkerConfig;

  private readonly store:
    GitHubLifecycleStore;

  private readonly processor:
    GitHubWorkflowRunProcessor;

  private readonly logger:
    GitHubWorkflowAutomationLogger;

  private readonly clock: () => Date;

  private timer: NodeJS.Timeout | undefined;

  private active = 0;

  private stopping = false;

  constructor(
    config:
      DurableGitHubWorkflowRunWorkerConfig,
    options:
      DurableGitHubWorkflowRunWorkerOptions,
  ) {
    this.config = config;
    this.store = options.store;
    this.processor = options.processor;
    this.logger = options.logger
      ?? defaultLogger;
    this.clock = options.clock
      ?? (() => new Date());
  }

  start(): void {
    if (this.timer !== undefined) {
      return;
    }

    this.stopping = false;
    this.timer = setInterval(
      () => {
        void this.drain();
      },
      this.config.pollIntervalMs,
    );
    this.timer.unref();
    void this.drain();
  }

  async stop(): Promise<void> {
    this.stopping = true;

    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    while (this.active > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
    }
  }

  async runOnce(): Promise<boolean> {
    const claimed =
      await this.store.claimWorkflowRunTask(
        this.config.leaseMs,
      );

    if (claimed === undefined) {
      return false;
    }

    try {
      const publication =
        await this.processor.process(
          claimed.task,
        );

      if (publication === undefined) {
        throw new Error(
          "Durable GitHub automation requires a Check Run publication result.",
        );
      }

      await this.store.completeWorkflowRunTask(
        claimed.taskId,
        publication.checkRunId,
      );
    } catch (error) {
      const errorCode =
        error instanceof HttpError
          ? error.code
          : "GITHUB_AUTOMATION_FAILED";

      const terminal =
        claimed.attempts
        >= this.config.maximumAttempts;

      const retryAt = new Date(
        this.clock().getTime()
        + (
          this.config.retryBaseMs
          * 2 ** Math.max(
            0,
            claimed.attempts - 1,
          )
        ),
      );

      await this.store.retryWorkflowRunTask(
        claimed.taskId,
        errorCode,
        retryAt,
        terminal,
      );

      this.logger.failed({
        deliveryId:
          claimed.task.deliveryId,
        repository:
          `${claimed.task.repository.owner}/${claimed.task.repository.name}`,
        workflowRunId:
          claimed.task.workflowRun.id,
        errorCode,
      });
    }

    return true;
  }

  private async drain(): Promise<void> {
    while (
      !this.stopping
      && this.active
        < this.config.concurrency
    ) {
      this.active += 1;

      void this.runOnce()
        .then((processed) => {
          this.active -= 1;

          if (processed) {
            void this.drain();
          }
        })
        .catch(() => {
          this.active -= 1;
        });
    }
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
