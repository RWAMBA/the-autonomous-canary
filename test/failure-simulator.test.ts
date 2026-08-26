import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createFailureSimulator,
  loadFailureSimulator,
} from "../src/failure-simulator.js";

test("disables simulated failures with interval zero", () => {
  const simulator = createFailureSimulator(0);

  assert.deepEqual(
    [
      simulator.shouldFail(),
      simulator.shouldFail(),
      simulator.shouldFail(),
    ],
    [
      false,
      false,
      false,
    ],
  );
  assert.equal(Object.isFrozen(simulator), true);
});

test("fails every configured request interval", () => {
  const simulator = createFailureSimulator(3);

  assert.deepEqual(
    [
      simulator.shouldFail(),
      simulator.shouldFail(),
      simulator.shouldFail(),
      simulator.shouldFail(),
      simulator.shouldFail(),
      simulator.shouldFail(),
    ],
    [
      false,
      false,
      true,
      false,
      false,
      true,
    ],
  );
});

test("loads and normalizes the environment value", () => {
  const simulator = loadFailureSimulator({
    SIMULATED_FAILURE_EVERY: " 2 ",
  });

  assert.deepEqual(
    [
      simulator.shouldFail(),
      simulator.shouldFail(),
      simulator.shouldFail(),
      simulator.shouldFail(),
    ],
    [
      false,
      true,
      false,
      true,
    ],
  );
});

test("uses disabled failures when configuration is absent", () => {
  const simulator = loadFailureSimulator({});

  assert.equal(simulator.shouldFail(), false);
});

test("rejects an invalid environment value", () => {
  assert.throws(
    () => loadFailureSimulator({
      SIMULATED_FAILURE_EVERY: "2.5",
    }),
    {
      message:
        "SIMULATED_FAILURE_EVERY must be a non-negative integer.",
    },
  );
});
