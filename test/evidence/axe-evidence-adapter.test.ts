import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  normalizeAxeReport,
} from "../../src/evidence/axe-evidence-adapter.js";

const context = {
  repository: {
    owner: "RWAMBA",
    name: "the-autonomous-canary",
  },
  workflow: {
    runId: 34_212_932_962,
    runAttempt: 1,
    headSha:
      "2751a8724607b60327689e936c4524838a92f41e",
  },
  pagePath: "/management",
  generatedAt: "2026-09-08T10:00:00.000Z",
} as const;

test("normalizes Axe violations without raw page or remediation content", () => {
  const result = normalizeAxeReport([
    {
      testEngine: {
        name: "axe-core",
        version: "4.13.0",
      },
      url: "http://127.0.0.1:3000/management",
      violations: [
        {
          id: "color-contrast",
          impact: "serious",
          description: "Provider description is excluded",
          help: "Provider help is excluded",
          helpUrl: "https://example.invalid/help",
          tags: ["wcag2aa"],
          nodes: [
            {
              impact: "serious",
              html: "<button>raw page content</button>",
              target: ["#download-evidence"],
              failureSummary:
                "Provider remediation is excluded",
            },
            {
              impact: "serious",
              html: "<a>raw page content</a>",
              target: ["#next-page"],
              failureSummary:
                "Provider remediation is excluded",
            },
          ],
        },
        {
          id: "document-title",
          impact: "critical",
          tags: ["wcag2a"],
          nodes: [
            {
              impact: "critical",
              target: ["html"],
            },
          ],
        },
        {
          id: "review-manually",
          impact: null,
          nodes: [
            {
              impact: null,
              target: ["main"],
            },
          ],
        },
      ],
    },
  ], context);

  assert.deepEqual(result, {
    schemaVersion:
      "canaryguard-axe-evidence-v1",
    source: "AXE",
    adapterVersion: "1.0.0",
    scannerVersion: "4.13.0",
    generatedAt:
      "2026-09-08T10:00:00.000Z",
    repository: context.repository,
    workflow: context.workflow,
    pagePath: "/management",
    findings: [
      {
        identifier: "document-title",
        category:
          "ACCESSIBILITY_VIOLATION",
        severity: "CRITICAL",
        title:
          "document-title affects 1 element",
        pagePath: "/management",
        affectedElements: 1,
      },
      {
        identifier: "color-contrast",
        category:
          "ACCESSIBILITY_VIOLATION",
        severity: "HIGH",
        title:
          "color-contrast affects 2 elements",
        pagePath: "/management",
        affectedElements: 2,
      },
    ],
    truncated: false,
  });

  assert.doesNotMatch(
    JSON.stringify(result),
    /Provider|raw page content|example\.invalid/u,
  );
});

test("deduplicates, orders, and truncates normalized Axe rules", () => {
  const violations = Array.from(
    {
      length: 52,
    },
    (_, index) => ({
      id: `rule-${String(100 - index).padStart(3, "0")}`,
      impact: "moderate",
      nodes: [
        {
          impact: "moderate",
          target: ["main"],
        },
      ],
    }),
  );

  violations.push(violations[0]!);

  const result = normalizeAxeReport([
    {
      testEngine: {
        name: "axe-core",
        version: "4.13.0",
      },
      url: "http://127.0.0.1:3000/management",
      violations,
    },
  ], context);

  assert.equal(result.findings.length, 50);
  assert.equal(result.truncated, true);
  assert.equal(
    result.findings[0]?.identifier,
    "rule-049",
  );
});

test("retains critical Axe rules before lower-severity findings when bounded", () => {
  const violations = [
    ...Array.from(
      {
        length: 51,
      },
      (_, index) => ({
        id: `a-low-${String(index).padStart(3, "0")}`,
        impact: "minor" as const,
        nodes: [
          {
            impact: "minor" as const,
            target: ["main"],
          },
        ],
      }),
    ),
    {
      id: "z-critical",
      impact: "critical" as const,
      nodes: [
        {
          impact: "critical" as const,
          target: ["main"],
        },
      ],
    },
  ];

  const result = normalizeAxeReport([
    {
      testEngine: {
        name: "axe-core",
        version: "4.13.0",
      },
      url: "http://127.0.0.1:3000/management",
      violations,
    },
  ], context);

  assert.equal(result.findings.length, 50);
  assert.equal(result.truncated, true);
  assert.equal(
    result.findings[0]?.identifier,
    "z-critical",
  );
  assert.equal(
    result.findings[0]?.severity,
    "CRITICAL",
  );
});

test("rejects Axe results for another page", () => {
  assert.throws(
    () => normalizeAxeReport([
      {
        testEngine: {
          name: "axe-core",
          version: "4.13.0",
        },
        url: "http://127.0.0.1:3000/admin",
        violations: [],
      },
    ], context),
  );
});
