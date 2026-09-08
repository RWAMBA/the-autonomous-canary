import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getCustomerAcquisitionAsset,
  customerAcquisitionHeaders,
} from "../src/customer-acquisition-assets.js";

test("serves a public acquisition page with roadmap services and safe boundaries", () => {
  const html = getCustomerAcquisitionAsset("/")?.body.toString("utf8") ?? "";

  for (const phrase of [
    "Release-risk assessment",
    "Managed GitHub App installation",
    "Release-policy implementation",
    "CI failure analysis setup",
    "Compliance evidence package",
    "Managed release support",
    "Request a release-risk assessment",
    "Request a managed deployment",
  ]) {
    assert.match(html, new RegExp(phrase, "u"));
  }

  assert.match(html, /name="workEmail"/u);
  assert.match(html, /Interactive decision demo/u);
  assert.match(html, /data-demo-scenario="critical-secret"/u);
  assert.match(html, /name="consent"/u);
  assert.doesNotMatch(
    html,
    /name="(?:apiKey|password|privateKey|sourceArchive|productionSecret)"/u,
  );
  assert.doesNotMatch(html, /\sstyle=/u);
  assert.match(html, /Do not submit source code, credentials, secrets, or production logs/u);
});

test("implements the product demo with fixed DOM-safe scenarios", () => {
  const script = getCustomerAcquisitionAsset("/acquisition.js")?.body.toString("utf8") ?? "";

  assert.match(script, /critical-secret/u);
  assert.match(script, /deterministic policy blocks deployment/iu);
  assert.match(script, /textContent/u);
  assert.doesNotMatch(script, /innerHTML|eval\(|new Function/u);
});

test("serves dedicated security and architecture disclosures", () => {
  const security = getCustomerAcquisitionAsset("/security")?.body.toString("utf8") ?? "";
  const architecture = getCustomerAcquisitionAsset("/architecture")?.body.toString("utf8") ?? "";

  assert.match(security, /Security and privacy/u);
  assert.match(security, /never requests credentials/u);
  assert.match(security, /180-day retention deadline/u);
  assert.match(architecture, /CanaryGuard architecture/u);
  assert.match(architecture, /Deterministic policy/u);
  assert.match(architecture, /PostgreSQL/u);
});

test("applies a locked-down browser policy to acquisition assets", () => {
  assert.match(
    customerAcquisitionHeaders["content-security-policy"],
    /default-src 'none'/u,
  );
  assert.equal(customerAcquisitionHeaders["x-frame-options"], "DENY");
  assert.equal(
    getCustomerAcquisitionAsset("/acquisition.js")?.contentType,
    "text/javascript; charset=utf-8",
  );
});
