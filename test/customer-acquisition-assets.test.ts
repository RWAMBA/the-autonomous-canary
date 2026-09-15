import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getCustomerAcquisitionAsset,
  customerAcquisitionHeaders,
} from "../src/customer-acquisition-assets.js";
import {
  getManagementDashboardAsset,
} from "../src/management-dashboard-assets.js";

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

test("serves the public Phase 9 portfolio case study", () => {
  const caseStudy = getCustomerAcquisitionAsset("/case-study")?.body.toString("utf8") ?? "";

  assert.match(caseStudy, /CanaryGuard case study/u);
  assert.match(caseStudy, /Deterministic policy authority/u);
  assert.match(caseStudy, /Production-validated/u);
  assert.match(caseStudy, /Known limitations/u);
  assert.match(caseStudy, /Live demonstration/u);
  assert.match(caseStudy, /^<!doctype html>/u);
  assert.match(caseStudy, /<a class="skip-link" href="#main">/u);
  assert.match(caseStudy, /<main id="main">/u);
  assert.equal(caseStudy.match(/<h1>/gu)?.length, 1);
  assert.doesNotMatch(caseStudy, /\sstyle=|<script|target="_blank"/u);

  const identifiers = [...caseStudy.matchAll(/\sid="([^"]+)"/gu)].map(
    ([, identifier]) => identifier,
  );
  assert.equal(new Set(identifiers).size, identifiers.length);
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

test("serves a safe SVG favicon referenced by every site surface", () => {
  const favicon = getCustomerAcquisitionAsset("/favicon.svg");
  const faviconMarkup = favicon?.body.toString("utf8") ?? "";

  assert.equal(favicon?.contentType, "image/svg+xml; charset=utf-8");
  assert.match(faviconMarkup, /^<svg /u);
  assert.match(faviconMarkup, /<title id="title">CanaryGuard<\/title>/u);
  assert.doesNotMatch(faviconMarkup, /<script|<foreignObject|(?:xlink:)?href=/iu);

  for (const pathname of ["/", "/security", "/architecture", "/case-study"]) {
    const html = getCustomerAcquisitionAsset(pathname)?.body.toString("utf8") ?? "";
    assert.match(html, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/u);
  }

  const dashboard = getManagementDashboardAsset("/management")?.body.toString("utf8") ?? "";
  assert.match(dashboard, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/u);
});
