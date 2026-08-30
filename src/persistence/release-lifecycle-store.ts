import type {
  ReviewRequestDto,
} from "../dto/review-request.js";
import type {
  ReviewResponseDto,
} from "../dto/review-response.js";
import type {
  DeterministicAssessment,
} from "../engines/deterministic/deterministic-engine.js";
import type {
  IntelligenceResult,
} from "../engines/intelligence/intelligence-engine.js";
import type {
  GitHubPullRequestWebhookDto,
  GitHubWorkflowRunWebhookDto,
} from "../dto/github-webhook.js";
import type {
  GitHubWorkflowRunTask,
} from "../github/github-workflow-task.js";

export interface ReviewPersistenceContext {
  readonly releaseId?: string;
}

export interface ReviewLifecycleRecord {
  readonly releaseId: string;
  readonly request: ReviewRequestDto;
  readonly deterministicAssessment:
    DeterministicAssessment;
  readonly intelligenceResult:
    IntelligenceResult;
  readonly response: ReviewResponseDto;
}

export interface ReviewLifecycleRecorder {
  resolveReleaseId(
    request: ReviewRequestDto,
    proposedReleaseId: string,
  ): Promise<string>;
  recordReview(
    record: ReviewLifecycleRecord,
  ): Promise<void>;
}

export interface PullRequestDeliveryInput {
  readonly deliveryId: string;
  readonly payload:
    GitHubPullRequestWebhookDto;
}

export interface PullRequestDeliveryResult {
  readonly releaseId: string;
}

export type WorkflowRunIgnoredReason =
  | "WORKFLOW_RUN_NOT_COMPLETED"
  | "WORKFLOW_RUN_PULL_REQUEST_UNAVAILABLE"
  | "WORKFLOW_RUN_PULL_REQUEST_CLOSED"
  | "WORKFLOW_RUN_HEAD_SUPERSEDED";

export type WorkflowRunDeliveryResult =
  | {
      readonly status: "IGNORED";
      readonly reason:
        WorkflowRunIgnoredReason;
    }
  | {
      readonly status: "ACCEPTED";
      readonly releaseId: string;
      readonly task:
        GitHubWorkflowRunTask;
    };

export interface WorkflowRunDeliveryInput {
  readonly deliveryId: string;
  readonly payload:
    GitHubWorkflowRunWebhookDto;
}

export interface IgnoredWebhookDeliveryInput {
  readonly deliveryId: string;
  readonly eventName: "check_run";
  readonly action: string;
  readonly repository: {
    readonly githubRepositoryId: number;
    readonly owner: string;
    readonly name: string;
  };
  readonly reason:
    "CHECK_RUN_EVENT_IGNORED";
}

export interface ClaimedWorkflowRunTask {
  readonly taskId: number;
  readonly attempts: number;
  readonly task: GitHubWorkflowRunTask;
}

export interface GitHubLifecycleStore {
  readonly durable: true;
  acceptPullRequestDelivery(
    input: PullRequestDeliveryInput,
  ): Promise<PullRequestDeliveryResult>;
  acceptWorkflowRunDelivery(
    input: WorkflowRunDeliveryInput,
  ): Promise<WorkflowRunDeliveryResult>;
  acceptIgnoredDelivery(
    input: IgnoredWebhookDeliveryInput,
  ): Promise<void>;
  claimWorkflowRunTask(
    leaseMs: number,
  ): Promise<
    ClaimedWorkflowRunTask | undefined
  >;
  completeWorkflowRunTask(
    taskId: number,
    checkRunId: number,
  ): Promise<void>;
  retryWorkflowRunTask(
    taskId: number,
    errorCode: string,
    retryAt: Date,
    terminal: boolean,
  ): Promise<void>;
  close(): Promise<void>;
}

export type ReleaseLifecycleStore =
  ReviewLifecycleRecorder
  & GitHubLifecycleStore;
