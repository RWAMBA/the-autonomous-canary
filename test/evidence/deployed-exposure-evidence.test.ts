import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateDeployedExposure,
} from "../../src/evidence/deployed-exposure-evidence.js";

test("returns no deployed-exposure findings for protected behavior", () => {
  assert.deepEqual(evaluateDeployedExposure({
    managementStatus: 401,
    traceStatus: 405,
  }), []);
});

test("reports unauthenticated management data and enabled TRACE", () => {
  assert.deepEqual(evaluateDeployedExposure({
    managementStatus: 200,
    traceStatus: 200,
  }).map((finding) => finding.identifier), [
    "EXPOSURE_UNAUTHENTICATED_MANAGEMENT",
    "EXPOSURE_HTTP_TRACE",
  ]);
});
