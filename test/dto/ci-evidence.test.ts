import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  maximumCiJobs,
  maximumCiLogCharacters,
  maximumCiLogExcerptLength,
  maximumCiStepsPerJob,
  parseCiEvidence,
} from "../../src/dto/ci-evidence.js";

function createEvidence() {
  return {
    provider: "GITHUB_ACTIONS",
    workflowName:
      "Continuous Integration",
    runId: 33_262_408_116,
    runAttempt: 1,
    conclusion: "failure",
    jobs: [
      {
        jobId: 101,
        name: "quality",
        conclusion: "failure",
        steps: [
          {
            number: 4,
            name: "Test",
            conclusion: "failure",
            logExcerpt:
              "AssertionError: expected 201",
          },
        ],
      },
    ],
  };
}

test("accepts and normalizes bounded GitHub Actions evidence", () => {
  const evidence = createEvidence();

  const result = parseCiEvidence({
    ...evidence,
    workflowName:
      " Continuous Integration ",
    jobs: [
      {
        ...evidence.jobs[0],
        name: " quality ",
      },
    ],
  });

  assert.equal(
    result.workflowName,
    "Continuous Integration",
  );
  assert.equal(
    result.jobs[0]?.name,
    "quality",
  );
});

test("defaults absent CI steps to an empty array", () => {
  const evidence = createEvidence();

  const result = parseCiEvidence({
    ...evidence,
    jobs: [
      {
        jobId: 101,
        name: "quality",
        conclusion: "success",
      },
    ],
  });

  assert.deepEqual(
    result.jobs[0]?.steps,
    [],
  );
});

test("rejects unsupported CI providers and conclusions", () => {
  const evidence = createEvidence();

  assert.throws(() => parseCiEvidence({
    ...evidence,
    provider: "UNTRUSTED_PROVIDER",
  }));

  assert.throws(() => parseCiEvidence({
    ...evidence,
    conclusion: "green",
  }));
});

test("rejects unknown CI evidence fields", () => {
  assert.throws(() => parseCiEvidence({
    ...createEvidence(),
    trustedDecision: "CONTINUE",
  }));
});

test("rejects duplicate job identifiers", () => {
  const evidence = createEvidence();
  const job = evidence.jobs[0];

  assert.ok(job);

  assert.throws(() => parseCiEvidence({
    ...evidence,
    jobs: [
      job,
      {
        ...job,
        name: "container",
      },
    ],
  }));
});

test("rejects duplicate step numbers within a job", () => {
  const evidence = createEvidence();
  const job = evidence.jobs[0];
  const step = job?.steps[0];

  assert.ok(job);
  assert.ok(step);

  assert.throws(() => parseCiEvidence({
    ...evidence,
    jobs: [
      {
        ...job,
        steps: [
          step,
          {
            ...step,
            name: "Build",
          },
        ],
      },
    ],
  }));
});

test("rejects an oversized individual log excerpt", () => {
  const evidence = createEvidence();
  const job = evidence.jobs[0];
  const step = job?.steps[0];

  assert.ok(job);
  assert.ok(step);

  assert.throws(() => parseCiEvidence({
    ...evidence,
    jobs: [
      {
        ...job,
        steps: [
          {
            ...step,
            logExcerpt: "x".repeat(
              maximumCiLogExcerptLength + 1,
            ),
          },
        ],
      },
    ],
  }));
});

test("rejects excessive combined CI log content", () => {
  const evidence = createEvidence();
  const job = evidence.jobs[0];

  assert.ok(job);

  const logLength = 7_000;
  const stepCount = Math.floor(
    maximumCiLogCharacters / logLength,
  ) + 1;

  assert.throws(() => parseCiEvidence({
    ...evidence,
    jobs: [
      {
        ...job,
        steps: Array.from(
          {
            length: stepCount,
          },
          (_, index) => ({
            number: index + 1,
            name: `Step ${index + 1}`,
            conclusion: "failure",
            logExcerpt:
              "x".repeat(logLength),
          }),
        ),
      },
    ],
  }));
});

test("rejects too many CI jobs", () => {
  const evidence = createEvidence();
  const job = evidence.jobs[0];

  assert.ok(job);

  assert.throws(() => parseCiEvidence({
    ...evidence,
    jobs: Array.from(
      {
        length: maximumCiJobs + 1,
      },
      (_, index) => ({
        ...job,
        jobId: index + 1,
      }),
    ),
  }));
});

test("rejects too many steps in one CI job", () => {
  const evidence = createEvidence();
  const job = evidence.jobs[0];

  assert.ok(job);

  assert.throws(() => parseCiEvidence({
    ...evidence,
    jobs: [
      {
        ...job,
        steps: Array.from(
          {
            length:
              maximumCiStepsPerJob + 1,
          },
          (_, index) => ({
            number: index + 1,
            name: `Step ${index + 1}`,
            conclusion: "success",
          }),
        ),
      },
    ],
  }));
});
