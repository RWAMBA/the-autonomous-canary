import assert from "node:assert/strict";
import { test } from "node:test";

import {
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
