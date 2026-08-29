import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  parseGitHubWebhookReceipt,
  parseGitHubWorkflowRunWebhook,
} from "../../src/dto/github-webhook.js";

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
