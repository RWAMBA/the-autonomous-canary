import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  DefaultManagementReportController,
} from "../../src/controllers/management-report-controller.js";
import type {
  ManagementReleaseDetailQuery,
  ManagementReleaseListQuery,
} from "../../src/dto/management-report.js";

const releaseId =
  "123e4567-e89b-42d3-a456-426614174000";

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

test("validates list parameters before querying persistence", async () => {
  let query:
    ManagementReleaseListQuery | undefined;
  const controller =
    new DefaultManagementReportController({
      listReleases: (input) => {
        query = input;
        return Promise.resolve({
          repository: {
            owner: "RWAMBA",
            name:
              "the-autonomous-canary",
          },
          releases: [],
        });
      },
      getRelease: () => {
        throw new Error("unexpected call");
      },
    });

  await controller.listReleases(
    new URLSearchParams({
      repositoryOwner: "RWAMBA",
      repositoryName:
        "the-autonomous-canary",
      limit: "10",
    }),
  );

  assert.equal(query?.limit, 10);

  await assert.rejects(
    controller.listReleases(
      new URLSearchParams({
        repositoryOwner: "RWAMBA",
        repositoryName: "canary",
        limit: "0",
      }),
    ),
    {
      name: "ZodError",
    },
  );
});

test("validates detail identity before querying persistence", async () => {
  let query:
    ManagementReleaseDetailQuery | undefined;
  const controller =
    new DefaultManagementReportController({
      listReleases: () => {
        throw new Error("unexpected call");
      },
      getRelease: (input) => {
        query = input;
        return Promise.resolve({
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
        });
      },
    });

  await controller.getRelease(
    releaseId,
    new URLSearchParams({
      repositoryOwner: "RWAMBA",
      repositoryName:
        "the-autonomous-canary",
    }),
  );

  assert.equal(query?.releaseId, releaseId);
});

test("rejects a persistence response outside the public DTO", async () => {
  const controller =
    new DefaultManagementReportController({
      listReleases: () => Promise.resolve({
        repository: {
          owner: "RWAMBA",
          name: "canary",
        },
        releases: [],
        rawPrompt:
          "untrusted prompt",
      } as never),
      getRelease: () => {
        throw new Error("unexpected call");
      },
    });

  await assert.rejects(
    controller.listReleases(
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

test("exports versioned evidence from the bounded detail contract", async () => {
  const controller = new DefaultManagementReportController(
    {
      listReleases: () => {
        throw new Error("unexpected call");
      },
      getRelease: () => Promise.resolve({
        repository: {
          owner: "RWAMBA",
          name: "the-autonomous-canary",
        },
        release,
        workflowRuns: { items: [], truncated: false },
        deterministicFindings: { items: [], truncated: false },
        deploymentAttempts: { items: [], truncated: false },
        auditEvents: { items: [], truncated: false },
      }),
    },
    {
      now: () => new Date("2026-09-07T18:42:07.000Z"),
    },
  );

  const report = await controller.exportRelease(
    releaseId,
    new URLSearchParams({
      repositoryOwner: "RWAMBA",
      repositoryName: "the-autonomous-canary",
    }),
  );

  assert.equal(report.schemaVersion, "canaryguard-evidence-report-v1");
  assert.equal(report.exportedAt, "2026-09-07T18:42:07.000Z");
  assert.equal(report.evidence.release.releaseId, releaseId);
});
