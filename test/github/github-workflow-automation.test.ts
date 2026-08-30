import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import type {
  ReviewController,
} from "../../src/controllers/review-controller.js";
import type {
  ReviewResponseDto,
} from "../../src/dto/review-response.js";
import type {
  GitHubCheckRunPublicationRequest,
  GitHubCiCollectionRequest,
  GitHubPullRequestChangeRequest,
} from "../../src/github/github-api-client.js";
import {
  DefaultGitHubWorkflowRunProcessor,
  DurableGitHubWorkflowRunWorker,
  InMemoryGitHubWorkflowRunQueue,
} from "../../src/github/github-workflow-automation.js";
import type {
  GitHubWorkflowRunTask,
} from "../../src/github/github-workflow-task.js";
import {
  HttpError,
} from "../../src/middleware/http-error.js";
import type {
  GitHubLifecycleStore,
} from "../../src/persistence/release-lifecycle-store.js";

const headSha =
  "7f7384d2ff38b5b908a0fc03787438dfbeab75c1";

const task: GitHubWorkflowRunTask = {
  deliveryId:
    "72d3162e-cc78-11e3-81ab-4c9367dc0958",
  installationId: 15_758_562,
  repository: {
    owner: "RWAMBA",
    name: "the-autonomous-canary",
  },
  workflowRun: {
    id: 33_282_285_533,
    runAttempt: 2,
    headSha,
    conclusion: "failure",
  },
  pullRequest: {
    number: 14,
  },
};

const review: ReviewResponseDto = {
  reviewId:
    "59b6f6d7-b052-4a40-8678-7621b8f44286",
  repository: task.repository,
  headSha,
  risk: {
    score: 90,
    level: "CRITICAL",
  },
  summary:
    "Release blocked by hard-coded policy: CI_FAILED.",
  findings: [],
  requiredActions: [],
  policyOverrides: [
    "CI_FAILED",
  ],
  analysis: {
    provider: "MOCK",
    modelTarget:
      "mock-canaryguard-v1",
    promptVersion:
      "canaryguard-review-v3",
  },
  decision: "BLOCK",
  deployment: {
    strategy: "BLOCKED",
    initialTrafficPercent: 0,
  },
};

test("collects exact workflow and pull-request evidence before publishing one Check Run", async () => {
  let evidenceRequest:
    GitHubCiCollectionRequest
    | undefined;
  let changeRequest:
    GitHubPullRequestChangeRequest
    | undefined;
  let reviewInput: unknown;
  let publicationRequest:
    GitHubCheckRunPublicationRequest
    | undefined;
  const completed: unknown[] = [];

  const reviewController:
    ReviewController = {
      createReview: async (input) => {
        reviewInput = input;
        return review;
      },
    };

  const processor =
    new DefaultGitHubWorkflowRunProcessor({
      evidenceCollector: {
        collect: async (input) => {
          evidenceRequest = input;
          return {
            provider:
              "GITHUB_ACTIONS",
            workflowName: "CI",
            runId:
              task.workflowRun.id,
            runAttempt: 2,
            conclusion: "failure",
            jobs: [
              {
                jobId: 1,
                name: "quality",
                conclusion:
                  "failure",
                steps: [
                  {
                    number: 10,
                    name: "Test",
                    conclusion:
                      "failure",
                  },
                ],
              },
            ],
          };
        },
      },
      changeCollector: {
        collectPullRequestChange:
          async (input) => {
            changeRequest = input;
            return {
              title:
                "Publish a Check Run",
              baseSha:
                "f50aeca81783a0240afd70d64d1ee7329c890f91",
              headSha,
              diff:
                "+export const checkRun = true;",
            };
          },
      },
      reviewController,
      checkRunPublisher: {
        publishCheckRun:
          async (input) => {
            publicationRequest = input;
            return {
              checkRunId: 901,
            };
          },
      },
      logger: {
        completed: (input) => {
          completed.push(input);
        },
        failed: () => {
          assert.fail(
            "Processor must not log a failure.",
          );
        },
      },
    });

  await processor.process(task);

  assert.deepEqual(evidenceRequest, {
    repository: task.repository,
    runId: task.workflowRun.id,
    expectedHeadSha: headSha,
    expectedRunAttempt: 2,
    expectedInstallationId:
      task.installationId,
  });
  assert.deepEqual(changeRequest, {
    repository: task.repository,
    pullRequestNumber: 14,
    expectedHeadSha: headSha,
    expectedInstallationId:
      task.installationId,
  });
  const normalizedReviewInput =
    reviewInput as {
      repository: unknown;
      change: unknown;
      evidence: {
        testStatus: unknown;
        securityFindings: unknown;
        ci: unknown;
      };
    };

  assert.deepEqual(
    {
      repository:
        normalizedReviewInput.repository,
      change:
        normalizedReviewInput.change,
      testStatus:
        normalizedReviewInput.evidence
          .testStatus,
      securityFindings:
        normalizedReviewInput.evidence
          .securityFindings,
    },
    {
      repository: task.repository,
      change: {
        title:
          "Publish a Check Run",
        baseSha:
          "f50aeca81783a0240afd70d64d1ee7329c890f91",
        headSha,
        diff:
          "+export const checkRun = true;",
      },
      testStatus: "failed",
      securityFindings: [],
    },
  );

  assert.deepEqual(
    normalizedReviewInput.evidence.ci,
    {
      provider: "GITHUB_ACTIONS",
      workflowName: "CI",
      runId: task.workflowRun.id,
      runAttempt: 2,
      conclusion: "failure",
      jobs: [
        {
          jobId: 1,
          name: "quality",
          conclusion: "failure",
          steps: [
            {
              number: 10,
              name: "Test",
              conclusion: "failure",
            },
          ],
        },
      ],
    },
  );
  assert.deepEqual(publicationRequest, {
    repository: task.repository,
    expectedInstallationId:
      task.installationId,
    workflowRunId:
      task.workflowRun.id,
    runAttempt: 2,
    headSha,
    review,
  });
  assert.deepEqual(completed, [
    {
      deliveryId: task.deliveryId,
      repository:
        "RWAMBA/the-autonomous-canary",
      workflowRunId:
        task.workflowRun.id,
      reviewId: review.reviewId,
      decision: "BLOCK",
      checkRunId: 901,
    },
  ]);
});

test("bounds the process-local queue and sanitizes asynchronous failures", async () => {
  const scheduled:
    Array<() => void> = [];
  const pendingResolvers:
    Array<() => void> = [];
  const failures: unknown[] = [];

  const queue =
    new InMemoryGitHubWorkflowRunQueue(
      {
        provider: "CHECKS",
        queueCapacity: 1,
        concurrency: 1,
      },
      {
        processor: {
          process: () => new Promise<void>(
            (resolve) => {
              pendingResolvers.push(
                resolve,
              );
            },
          ),
        },
        schedule: (callback) => {
          scheduled.push(callback);
        },
        logger: {
          completed: () => {},
          failed: (input) => {
            failures.push(input);
          },
        },
      },
    );

  queue.dispatch(task);

  assert.throws(
    () => queue.dispatch({
      ...task,
      deliveryId:
        "82d3162e-cc78-11e3-81ab-4c9367dc0958",
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(
        error.code,
        "GITHUB_AUTOMATION_QUEUE_CAPACITY_EXCEEDED",
      );
      return true;
    },
  );

  scheduled.shift()?.();
  assert.equal(pendingResolvers.length, 1);
  pendingResolvers.shift()?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(failures, []);
});

test("logs only a controlled error code when an asynchronous task fails", async () => {
  const scheduled:
    Array<() => void> = [];
  const failures: unknown[] = [];

  const queue =
    new InMemoryGitHubWorkflowRunQueue(
      {
        provider: "CHECKS",
        queueCapacity: 2,
        concurrency: 1,
      },
      {
        processor: {
          process: async () => {
            throw new Error(
              "provider secret response",
            );
          },
        },
        schedule: (callback) => {
          scheduled.push(callback);
        },
        logger: {
          completed: () => {},
          failed: (input) => {
            failures.push(input);
          },
        },
      },
    );

  queue.dispatch(task);
  scheduled.shift()?.();
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(failures, [
    {
      deliveryId: task.deliveryId,
      repository:
        "RWAMBA/the-autonomous-canary",
      workflowRunId:
        task.workflowRun.id,
      errorCode:
        "GITHUB_AUTOMATION_FAILED",
    },
  ]);
  assert.equal(
    JSON.stringify(failures).includes(
      "provider secret response",
    ),
    false,
  );
});

test("claims and completes a durable workflow task with its stable release identifier", async () => {
  const durableTask = {
    ...task,
    releaseId:
      "123e4567-e89b-42d3-a456-426614174000",
  };
  const completed: unknown[] = [];
  let claimed = false;

  const store:
    GitHubLifecycleStore = {
      durable: true,
      acceptPullRequestDelivery:
        async () => ({
          releaseId:
            durableTask.releaseId,
        }),
      acceptWorkflowRunDelivery:
        async () => ({
          status: "ACCEPTED",
          releaseId:
            durableTask.releaseId,
          task: durableTask,
        }),
      acceptIgnoredDelivery:
        async () => undefined,
      claimWorkflowRunTask:
        async () => {
          if (claimed) {
            return undefined;
          }

          claimed = true;
          return {
            taskId: 41,
            attempts: 1,
            task: durableTask,
          };
        },
      completeWorkflowRunTask:
        async (taskId, checkRunId) => {
          completed.push({
            taskId,
            checkRunId,
          });
        },
      retryWorkflowRunTask:
        async () => {
          assert.fail(
            "Successful tasks must not be retried.",
          );
        },
      close: async () => undefined,
    };

  const worker =
    new DurableGitHubWorkflowRunWorker(
      {
        concurrency: 1,
        pollIntervalMs: 1_000,
        leaseMs: 60_000,
        maximumAttempts: 3,
        retryBaseMs: 5_000,
      },
      {
        store,
        processor: {
          process: async (input) => {
            assert.equal(
              input.releaseId,
              durableTask.releaseId,
            );
            return {
              checkRunId: 7_001,
            };
          },
        },
      },
    );

  assert.equal(
    await worker.runOnce(),
    true,
  );
  assert.deepEqual(completed, [
    {
      taskId: 41,
      checkRunId: 7_001,
    },
  ]);
  assert.equal(
    await worker.runOnce(),
    false,
  );
});

test("bounds durable retries and records only a controlled error code", async () => {
  const retried: unknown[] = [];
  const durableTask = {
    ...task,
    releaseId:
      "123e4567-e89b-42d3-a456-426614174000",
  };

  const store = {
    durable: true as const,
    acceptPullRequestDelivery:
      async () => ({
        releaseId:
          durableTask.releaseId,
      }),
    acceptWorkflowRunDelivery:
      async () => ({
        status: "ACCEPTED" as const,
        releaseId:
          durableTask.releaseId,
        task: durableTask,
      }),
    acceptIgnoredDelivery:
      async () => undefined,
    claimWorkflowRunTask:
      async () => ({
        taskId: 42,
        attempts: 3,
        task: durableTask,
      }),
    completeWorkflowRunTask:
      async () => {
        assert.fail(
          "Failed tasks must not complete.",
        );
      },
    retryWorkflowRunTask:
      async (
        taskId: number,
        errorCode: string,
        retryAt: Date,
        terminal: boolean,
      ) => {
        retried.push({
          taskId,
          errorCode,
          retryAt:
            retryAt.toISOString(),
          terminal,
        });
      },
    close: async () => undefined,
  } satisfies GitHubLifecycleStore;

  const worker =
    new DurableGitHubWorkflowRunWorker(
      {
        concurrency: 1,
        pollIntervalMs: 1_000,
        leaseMs: 60_000,
        maximumAttempts: 3,
        retryBaseMs: 5_000,
      },
      {
        store,
        clock: () => new Date(
          "2026-08-30T00:00:00.000Z",
        ),
        processor: {
          process: async () => {
            throw new Error(
              "credential-bearing provider response",
            );
          },
        },
      },
    );

  await worker.runOnce();

  assert.deepEqual(retried, [
    {
      taskId: 42,
      errorCode:
        "GITHUB_AUTOMATION_FAILED",
      retryAt:
        "2026-08-30T00:00:20.000Z",
      terminal: true,
    },
  ]);
  assert.equal(
    JSON.stringify(retried).includes(
      "credential-bearing",
    ),
    false,
  );
});
