import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  parseGitHubCheckRunWebhook,
  parseGitHubPullRequestWebhook,
  parseGitHubWebhookReceipt,
  parseGitHubWorkflowRunWebhook,
} from "../../src/dto/github-webhook.js";

function createPullRequestPayload() {
  return {
    action: "synchronize",
    number: 21,
    installation: {
      id: 15_758_562,
    },
    repository: {
      id: 101,
      full_name:
        "RWAMBA/the-autonomous-canary",
      name:
        "the-autonomous-canary",
      owner: {
        login: "RWAMBA",
      },
    },
    pull_request: {
      number: 21,
      state: "open",
      draft: false,
      title:
        "Persist the release lifecycle",
      created_at:
        "2026-08-30T00:00:00.000Z",
      closed_at: null,
      head: {
        sha:
          "b70e3e7bcef06a1ff3096790079e3cea564054a0",
      },
      base: {
        sha:
          "ed4254dfe8c364b5e9e4150eaee0214db250b6e5",
      },
      body:
        "Untrusted body content is discarded.",
    },
  };
}

function createPayload() {
  return {
    action: "completed",
    installation: {
      id: 15_758_562,
      extra: "ignored",
    },
    repository: {
      id: 101,
      full_name:
        "RWAMBA/the-autonomous-canary",
      name:
        "the-autonomous-canary",
      owner: {
        login: "RWAMBA",
        extra: "ignored",
      },
      private: false,
    },
    workflow_run: {
      id: 33_273_782_416,
      name:
        "Continuous Integration",
      status: "completed",
      conclusion: "success",
      run_attempt: 1,
      head_sha:
        "1ca9fd52769fe3d4e60e02e02d8fe73f1e91f45a",
      head_commit: {
        id:
          "1ca9fd52769fe3d4e60e02e02d8fe73f1e91f45a",
      },
      repository: {
        id: 101,
        full_name:
          "RWAMBA/the-autonomous-canary",
        name:
          "the-autonomous-canary",
        owner: {
          login: "RWAMBA",
        },
      },
      pull_requests: [
        {
          number: 14,
          url:
            "https://api.github.test/pulls/14",
        },
      ],
      jobs_url:
        "https://api.github.test/jobs",
    },
    sender: {
      login: "octocat",
    },
  };
}

test("accepts and normalizes a bounded completed workflow_run payload", () => {
  const payload =
    parseGitHubWorkflowRunWebhook(
      createPayload(),
    );

  assert.equal(
    payload.workflow_run.id,
    33_273_782_416,
  );
  assert.equal(
    "sender" in payload,
    false,
  );
  assert.equal(
    "jobs_url" in payload.workflow_run,
    false,
  );
  assert.deepEqual(
    payload.workflow_run.pull_requests,
    [
      {
        number: 14,
      },
    ],
  );
});

test("accepts known nonterminal workflow_run actions for filtering", () => {
  for (const action of [
    "requested",
    "in_progress",
  ] as const) {
    const input = createPayload();
    input.action = action;
    input.workflow_run.status = action;
    input.workflow_run.conclusion = null as unknown as string;

    const payload =
      parseGitHubWorkflowRunWebhook(
        input,
      );

    assert.equal(payload.action, action);
  }
});

test("requires completed deliveries to contain terminal workflow data", () => {
  const incompleteStatus =
    createPayload();
  incompleteStatus.workflow_run.status =
    "in_progress";

  assert.throws(
    () => parseGitHubWorkflowRunWebhook(
      incompleteStatus,
    ),
  );

  const missingConclusion =
    createPayload();
  missingConclusion.workflow_run.conclusion =
    null as unknown as string;

  assert.throws(
    () => parseGitHubWorkflowRunWebhook(
      missingConclusion,
    ),
  );
});

test("rejects unsupported actions and malformed trusted identifiers", () => {
  const unsupportedAction =
    createPayload();
  unsupportedAction.action = "rerun";

  assert.throws(
    () => parseGitHubWorkflowRunWebhook(
      unsupportedAction,
    ),
  );

  const invalidRunId = createPayload();
  invalidRunId.workflow_run.id = -1;

  assert.throws(
    () => parseGitHubWorkflowRunWebhook(
      invalidRunId,
    ),
  );
});

test("accepts internally consistent webhook receipts", () => {
  const accepted =
    parseGitHubWebhookReceipt({
      deliveryId:
        "72d3162e-cc78-11e3-81ab-4c9367dc0958",
      event: "workflow_run",
      status: "ACCEPTED",
      repository: {
        owner: "RWAMBA",
        name:
          "the-autonomous-canary",
      },
      workflowRun: {
        id: 33_273_782_416,
        runAttempt: 1,
        headSha:
          "1ca9fd52769fe3d4e60e02e02d8fe73f1e91f45a",
        conclusion: "success",
      },
    });

  assert.equal(
    accepted.status,
    "ACCEPTED",
  );

  assert.throws(
    () => parseGitHubWebhookReceipt({
      ...accepted,
      status: "IGNORED",
    }),
  );
});

test("normalizes direct pull_request lifecycle events without retaining body content", () => {
  const payload =
    parseGitHubPullRequestWebhook(
      createPullRequestPayload(),
    );

  assert.equal(payload.action, "synchronize");
  assert.equal(payload.number, 21);
  assert.equal(
    "body" in payload.pull_request,
    false,
  );

  const receipt =
    parseGitHubWebhookReceipt({
      deliveryId:
        "72d3162e-cc78-11e3-81ab-4c9367dc0958",
      event: "pull_request",
      status: "ACCEPTED",
      repository: {
        owner: "RWAMBA",
        name:
          "the-autonomous-canary",
      },
      pullRequest: {
        number: 21,
        headSha:
          "b70e3e7bcef06a1ff3096790079e3cea564054a0",
        state: "OPEN",
      },
      releaseId:
        "123e4567-e89b-42d3-a456-426614174000",
    });

  assert.equal(
    receipt.event,
    "pull_request",
  );

  const mismatch =
    createPullRequestPayload();
  mismatch.pull_request.number = 22;

  assert.throws(
    () => parseGitHubPullRequestWebhook(
      mismatch,
    ),
  );
});

test("normalizes bounded check_run loop-prevention deliveries", () => {
  const payload = parseGitHubCheckRunWebhook({
    action: "completed",
    repository: {
      id: 101,
      full_name:
        "RWAMBA/the-autonomous-canary",
      name:
        "the-autonomous-canary",
      owner: {
        login: "RWAMBA",
      },
    },
    check_run: {
      id: 7_001,
      output: {
        text:
          "untrusted content",
      },
    },
  });

  assert.deepEqual(payload, {
    action: "completed",
    repository: {
      id: 101,
      full_name:
        "RWAMBA/the-autonomous-canary",
      name:
        "the-autonomous-canary",
      owner: {
        login: "RWAMBA",
      },
    },
  });

  assert.deepEqual(
    parseGitHubWebhookReceipt({
      deliveryId:
        "72d3162e-cc78-11e3-81ab-4c9367dc0958",
      event: "check_run",
      status: "IGNORED",
      reason:
        "CHECK_RUN_EVENT_IGNORED",
      repository: {
        owner: "RWAMBA",
        name:
          "the-autonomous-canary",
      },
    }),
    {
      deliveryId:
        "72d3162e-cc78-11e3-81ab-4c9367dc0958",
      event: "check_run",
      status: "IGNORED",
      reason:
        "CHECK_RUN_EVENT_IGNORED",
      repository: {
        owner: "RWAMBA",
        name:
          "the-autonomous-canary",
      },
    },
  );
});
