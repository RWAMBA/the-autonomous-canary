import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  parseCiEvidence,
} from "../../src/dto/ci-evidence.js";
import {
  DefaultCiInvestigator,
} from "../../src/engines/ci/ci-investigator.js";

function createEvidence(
  conclusion:
    | "success"
    | "failure"
    | "cancelled" = "success",
) {
  return parseCiEvidence({
    provider: "GITHUB_ACTIONS",
    workflowName:
      "Continuous Integration",
    runId: 33_262_408_116,
    runAttempt: 1,
    conclusion,
    jobs: [
      {
        jobId: 101,
        name: "quality",
        conclusion,
        steps: [
          {
            number: 4,
            name: "Test",
            conclusion,
            logExcerpt:
              "Untrusted diagnostic content",
          },
        ],
      },
    ],
  });
}

test("reports a successful completed workflow", () => {
  const result =
    new DefaultCiInvestigator()
      .investigate(
        createEvidence(),
      );

  assert.equal(result.outcome, "PASSED");
  assert.deepEqual(result.summary, {
    totalJobs: 1,
    failedJobs: 0,
    incompleteJobs: 0,
    failedSteps: 0,
    incompleteSteps: 0,
  });
  assert.deepEqual(
    result.problemJobs,
    [],
  );
});

test("reports failed jobs and steps without returning log content", () => {
  const result =
    new DefaultCiInvestigator()
      .investigate(
        createEvidence("failure"),
      );

  assert.equal(result.outcome, "FAILED");
  assert.deepEqual(result.summary, {
    totalJobs: 1,
    failedJobs: 1,
    incompleteJobs: 0,
    failedSteps: 1,
    incompleteSteps: 0,
  });
  assert.deepEqual(
    result.problemJobs,
    [
      {
        jobId: 101,
        name: "quality",
        conclusion: "failure",
        problemSteps: [
          {
            number: 4,
            name: "Test",
            conclusion: "failure",
          },
        ],
      },
    ],
  );
  assert.equal(
    JSON.stringify(result).includes(
      "Untrusted diagnostic content",
    ),
    false,
  );
});

test("reports cancelled evidence as incomplete", () => {
  const result =
    new DefaultCiInvestigator()
      .investigate(
        createEvidence("cancelled"),
      );

  assert.equal(
    result.outcome,
    "INCOMPLETE",
  );
  assert.equal(
    result.summary.incompleteJobs,
    1,
  );
  assert.equal(
    result.summary.incompleteSteps,
    1,
  );
});

test("honors a failed workflow conclusion when jobs report success", () => {
  const evidence = createEvidence();

  const result =
    new DefaultCiInvestigator()
      .investigate(
        parseCiEvidence({
          ...evidence,
          conclusion: "startup_failure",
        }),
      );

  assert.equal(result.outcome, "FAILED");
  assert.equal(
    result.summary.failedJobs,
    0,
  );
});

test("treats a failed job as authoritative when the workflow says success", () => {
  const evidence = createEvidence();
  const job = evidence.jobs[0];

  assert.ok(job);

  const result =
    new DefaultCiInvestigator()
      .investigate(
        parseCiEvidence({
          ...evidence,
          jobs: [
            {
              ...job,
              conclusion: "timed_out",
            },
          ],
        }),
      );

  assert.equal(result.outcome, "FAILED");
  assert.equal(
    result.summary.failedJobs,
    1,
  );
});

test("freezes the complete investigation result", () => {
  const result =
    new DefaultCiInvestigator()
      .investigate(
        createEvidence("failure"),
      );

  assert.equal(
    Object.isFrozen(result),
    true,
  );
  assert.equal(
    Object.isFrozen(result.summary),
    true,
  );
  assert.equal(
    Object.isFrozen(result.problemJobs),
    true,
  );
  assert.equal(
    Object.isFrozen(
      result.problemJobs[0],
    ),
    true,
  );
  assert.equal(
    Object.isFrozen(
      result.problemJobs[0]
        ?.problemSteps,
    ),
    true,
  );
});

test("does not modify the validated CI evidence", () => {
  const evidence =
    createEvidence("failure");
  const before = JSON.stringify(evidence);

  new DefaultCiInvestigator()
    .investigate(evidence);

  assert.equal(
    JSON.stringify(evidence),
    before,
  );
});
