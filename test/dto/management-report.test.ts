import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  createManagementReleaseCursor,
  defaultManagementReleasePageSize,
  parseManagementReleaseDetail,
  parseManagementReleaseDetailQuery,
  parseManagementEvidenceReport,
  parseManagementReleaseList,
  parseManagementReleaseListQuery,
} from "../../src/dto/management-report.js";

const releaseId =
  "123e4567-e89b-42d3-a456-426614174000";

test("parses a repository-scoped release list query with a bounded default", () => {
  assert.deepEqual(
    parseManagementReleaseListQuery(
      new URLSearchParams({
        repositoryOwner: "RWAMBA",
        repositoryName:
          "the-autonomous-canary",
      }),
    ),
    {
      repositoryOwner: "RWAMBA",
      repositoryName:
        "the-autonomous-canary",
      limit:
        defaultManagementReleasePageSize,
    },
  );
});

test("parses an exact head-SHA release lookup", () => {
  assert.deepEqual(
    parseManagementReleaseListQuery(
      new URLSearchParams({
        repositoryOwner: "RWAMBA",
        repositoryName:
          "the-autonomous-canary",
        headSha:
          "3128a8c383889ae107e9a999778be70a2263a21a",
        limit: "2",
      }),
    ),
    {
      repositoryOwner: "RWAMBA",
      repositoryName:
        "the-autonomous-canary",
      headSha:
        "3128a8c383889ae107e9a999778be70a2263a21a",
      limit: 2,
    },
  );
});

test("round-trips an opaque repository-bound release cursor", () => {
  const token = createManagementReleaseCursor({
    version: 1,
    repositoryOwner: "RWAMBA",
    repositoryName:
      "the-autonomous-canary",
    createdAt:
      "2026-08-30T18:47:11.000Z",
    releaseId,
  });

  assert.deepEqual(
    parseManagementReleaseListQuery(
      new URLSearchParams({
        repositoryOwner: "rwamba",
        repositoryName:
          "THE-AUTONOMOUS-CANARY",
        limit: "50",
        cursor: token,
      }),
    ),
    {
      repositoryOwner: "rwamba",
      repositoryName:
        "THE-AUTONOMOUS-CANARY",
      limit: 50,
      cursor: {
        version: 1,
        repositoryOwner: "RWAMBA",
        repositoryName:
          "the-autonomous-canary",
        createdAt:
          "2026-08-30T18:47:11.000Z",
        releaseId,
      },
    },
  );
});

test("rejects a cursor from another repository", () => {
  const token = createManagementReleaseCursor({
    version: 1,
    repositoryOwner: "RWAMBA",
    repositoryName: "another-repository",
    createdAt:
      "2026-08-30T18:47:11.000Z",
    releaseId,
  });

  assert.throws(
    () => parseManagementReleaseListQuery(
      new URLSearchParams({
        repositoryOwner: "RWAMBA",
        repositoryName:
          "the-autonomous-canary",
        cursor: token,
      }),
    ),
    {
      name: "ZodError",
    },
  );
});

test("rejects a cursor on an exact head-SHA lookup", () => {
  const cursor = createManagementReleaseCursor({
    version: 1,
    repositoryOwner: "RWAMBA",
    repositoryName:
      "the-autonomous-canary",
    createdAt:
      "2026-08-30T18:47:11.000Z",
    releaseId,
  });

  assert.throws(
    () => parseManagementReleaseListQuery(
      new URLSearchParams({
        repositoryOwner: "RWAMBA",
        repositoryName:
          "the-autonomous-canary",
        headSha:
          "3128a8c383889ae107e9a999778be70a2263a21a",
        cursor,
      }),
    ),
    {
      name: "ZodError",
    },
  );
});

test("rejects malformed, duplicate, unknown, and oversized list parameters", () => {
  for (const parameters of [
    "repositoryOwner=RWAMBA&repositoryName=canary&cursor=not%2Bbase64",
    "repositoryOwner=RWAMBA&repositoryOwner=OTHER&repositoryName=canary",
    "repositoryOwner=RWAMBA&repositoryName=canary&unknown=true",
    "repositoryOwner=RWAMBA&repositoryName=canary&limit=101",
  ]) {
    assert.throws(
      () => parseManagementReleaseListQuery(
        new URLSearchParams(parameters),
      ),
      {
        name: "ZodError",
      },
    );
  }
});

test("parses a strict repository-scoped release detail query", () => {
  assert.deepEqual(
    parseManagementReleaseDetailQuery(
      releaseId,
      new URLSearchParams({
        repositoryOwner: "RWAMBA",
        repositoryName:
          "the-autonomous-canary",
      }),
    ),
    {
      releaseId,
      repositoryOwner: "RWAMBA",
      repositoryName:
        "the-autonomous-canary",
    },
  );

  assert.throws(
    () => parseManagementReleaseDetailQuery(
      "not-a-uuid",
      new URLSearchParams({
        repositoryOwner: "RWAMBA",
        repositoryName: "canary",
      }),
    ),
    {
      name: "ZodError",
    },
  );
});

test("accepts bounded normalized management responses", () => {
  const release = {
    releaseId,
    headSha:
      "ae222bdc592e3721fc9024a02b20759e25cdb3f9",
    status: "COMPLETED" as const,
    createdAt:
      "2026-08-30T18:47:11.000Z",
    updatedAt:
      "2026-08-30T18:52:22.000Z",
  };

  assert.deepEqual(
    parseManagementReleaseList({
      repository: {
        owner: "RWAMBA",
        name:
          "the-autonomous-canary",
      },
      releases: [
        release,
      ],
    }).releases[0],
    release,
  );

  assert.equal(
    parseManagementReleaseDetail({
      repository: {
        owner: "RWAMBA",
        name:
          "the-autonomous-canary",
      },
      release,
      workflowRuns: {
        items: [],
        truncated: false,
      },
      deterministicFindings: {
        items: [
          {
            code:
              "TRIVY_DEPENDENCY_VULNERABILITY_HIGH",
            severity: "HIGH",
            title:
              "CVE-2026-1000 affects example@1.0.0",
            explanation:
              "Trivy reported a dependency vulnerability.",
            blocking: false,
            evidenceAttribution: {
              source: "TRIVY",
              sourceVersion: "1.0.0",
              identifier: "CVE-2026-1000",
              category:
                "DEPENDENCY_VULNERABILITY",
              generatedAt:
                "2026-09-07T18:42:07.000Z",
            },
            createdAt:
              "2026-09-07T18:42:08.000Z",
          },
          {
            code:
              "AXE_ACCESSIBILITY_VIOLATION_CRITICAL",
            severity: "CRITICAL",
            title:
              "button-name affects 1 element",
            explanation:
              "Axe reported an accessibility violation.",
            filePath: "/management",
            blocking: true,
            evidenceAttribution: {
              source: "AXE",
              sourceVersion: "4.13.0",
              identifier: "button-name",
              category:
                "ACCESSIBILITY_VIOLATION",
              generatedAt:
                "2026-09-08T10:00:00.000Z",
            },
            createdAt:
              "2026-09-08T10:00:01.000Z",
          },
          {
            code: "TRIVY_SECRET_SECRET_EXPOSURE_CRITICAL",
            severity: "CRITICAL",
            title: "Generic API key",
            explanation: "Trivy secret scanning reported an exposure.",
            filePath: ".env.example",
            blocking: true,
            evidenceAttribution: {
              source: "TRIVY_SECRET",
              sourceVersion: "1.0.0",
              identifier: "generic-api-key",
              category: "SECRET_EXPOSURE",
              generatedAt: "2026-09-08T10:00:00.000Z",
            },
            createdAt: "2026-09-08T10:00:01.000Z",
          },
        ],
        truncated: false,
      },
      deploymentAttempts: {
        items: [],
        truncated: false,
      },
      auditEvents: {
        items: [],
        truncated: false,
      },
    }).release.releaseId,
    releaseId,
  );
});

test("accepts a versioned bounded evidence export", () => {
  const report = parseManagementEvidenceReport({
    schemaVersion: "canaryguard-evidence-report-v1",
    exportedAt: "2026-09-07T18:42:07.000Z",
    evidence: {
      repository: {
        owner: "RWAMBA",
        name: "the-autonomous-canary",
      },
      release: {
        releaseId,
        headSha: "7938c00196816b1c742c83603b38185b06380bd1",
        status: "COMPLETED",
        createdAt: "2026-09-07T18:31:33.000Z",
        updatedAt: "2026-09-07T18:42:07.000Z",
      },
      workflowRuns: {
        items: [],
        truncated: false,
      },
      deterministicFindings: {
        items: [],
        truncated: false,
      },
      deploymentAttempts: {
        items: [],
        truncated: false,
      },
      auditEvents: {
        items: [],
        truncated: false,
      },
    },
  });

  assert.equal(
    report.evidence.release.releaseId,
    releaseId,
  );
});

test("rejects raw or unrestricted fields in management responses", () => {
  assert.throws(
    () => parseManagementReleaseList({
      repository: {
        owner: "RWAMBA",
        name: "canary",
      },
      releases: [],
      rawDiff: "+secret",
    }),
    {
      name: "ZodError",
    },
  );

  assert.throws(
    () => parseManagementEvidenceReport({
      schemaVersion:
        "canaryguard-evidence-report-v1",
      exportedAt:
        "2026-09-07T18:42:07.000Z",
      evidence: {
        repository: {
          owner: "RWAMBA",
          name: "canary",
        },
        release: {
          releaseId,
          headSha:
            "7938c00196816b1c742c83603b38185b06380bd1",
          status: "COMPLETED",
          createdAt:
            "2026-09-07T18:31:33.000Z",
          updatedAt:
            "2026-09-07T18:42:07.000Z",
        },
        workflowRuns: {
          items: [],
          truncated: false,
        },
        deterministicFindings: {
          items: [],
          truncated: false,
        },
        deploymentAttempts: {
          items: [],
          truncated: false,
        },
        auditEvents: {
          items: [],
          truncated: false,
        },
        rawModelOutput: "secret",
      },
    }),
    {
      name: "ZodError",
    },
  );
});
