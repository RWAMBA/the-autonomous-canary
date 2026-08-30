import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readCanaryTrafficPercent,
  routingConfigForMode,
  routingModeForDecision,
} from "../src/routing-mode.js";

test("continues with canary routing", () => {
  assert.equal(
    routingModeForDecision("continue"),
    "canary",
  );
});

test("promotes traffic to the canary", () => {
  assert.equal(
    routingModeForDecision("promote"),
    "promote",
  );
});

test("rolls traffic back to stable", () => {
  assert.equal(
    routingModeForDecision("rollback"),
    "rollback",
  );
});

test("accepts only policy-supported canary traffic", () => {
  assert.equal(
    readCanaryTrafficPercent(undefined),
    10,
  );
  assert.equal(
    readCanaryTrafficPercent("5"),
    5,
  );
  assert.equal(
    readCanaryTrafficPercent("10"),
    10,
  );

  assert.throws(
    () => readCanaryTrafficPercent("15"),
    {
      message:
        "CANARY_INITIAL_TRAFFIC_PERCENT must be 5 or 10.",
    },
  );

  assert.throws(
    () => readCanaryTrafficPercent("05"),
    /must be 5 or 10/u,
  );
});

test("maps canary traffic to an exact routing config", () => {
  assert.equal(
    routingConfigForMode("canary", 5),
    "canary-5",
  );
  assert.equal(
    routingConfigForMode("canary", 10),
    "canary-10",
  );
  assert.equal(
    routingConfigForMode("promote", 5),
    "promote",
  );
  assert.equal(
    routingConfigForMode("rollback", 10),
    "rollback",
  );
});
