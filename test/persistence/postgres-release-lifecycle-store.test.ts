import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import type {
  Pool,
} from "pg";

import {
  parseGitHubPullRequestWebhook,
  parseGitHubWorkflowRunWebhook,
} from "../../src/dto/github-webhook.js";
import {
  normalizePostgresConnectionUrl,
  PostgresReleaseLifecycleStore,
} from "../../src/persistence/postgres-release-lifecycle-store.js";

const releaseId =
  "123e4567-e89b-42d3-a456-426614174000";

const headSha =
  "b70e3e7bcef06a1ff3096790079e3cea564054a0";

function createPullRequestPayload(
  action: "closed" | "reopened",
) {
  return parseGitHubPullRequestWebhook({
    action,
    number: 21,
    installation: {
      id: 15_758_562,
    },
    repository: {
      id: 101,
      full_name:
        "RWAMBA/the-autonomous-canary",
      name:
        "the-autonomous-canary",
      owner: {
        login: "RWAMBA",
      },
    },
    pull_request: {
      number: 21,
      state: action === "closed"
        ? "closed"
        : "open",
      draft: false,
      title:
        "Persist the release lifecycle",
      created_at:
        "2026-08-30T00:00:00.000Z",
      closed_at: action === "closed"
        ? "2026-08-30T01:00:00.000Z"
        : null,
      head: {
        sha: headSha,
      },
      base: {
        sha:
          "ed4254dfe8c364b5e9e4150eaee0214db250b6e5",
      },
    },
  });
}

function createWorkflowRunPayload() {
  return parseGitHubWorkflowRunWebhook({
    action: "completed",
    installation: {
      id: 15_758_562,
    },
    repository: {
      id: 101,
      full_name:
        "RWAMBA/the-autonomous-canary",
      name:
        "the-autonomous-canary",
      owner: {
        login: "RWAMBA",
      },
    },
    workflow_run: {
      id: 33_311_266_897,
      name:
        "Continuous Integration",
      status: "completed",
      conclusion: "success",
      run_attempt: 1,
      head_sha: headSha,
      head_commit: {
        id: headSha,
      },
      repository: {
        id: 101,
        full_name:
          "RWAMBA/the-autonomous-canary",
        name:
          "the-autonomous-canary",
        owner: {
          login: "RWAMBA",
        },
      },
      pull_requests: [
        {
          number: 21,
        },
      ],
    },
  });
}

function normalizeSql(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function createPool(
  query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{
    readonly rows: readonly unknown[];
    readonly rowCount?: number;
  }>,
): Pool {
  const client = {
    query,
    release: () => undefined,
  };

  return {
    connect: async () => client,
  } as unknown as Pool;
}

test("normalizes required PostgreSQL TLS to certificate and hostname verification", () => {
  const normalized =
    normalizePostgresConnectionUrl(
      "postgresql://canaryguard:test-password@ep-example-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
      "REQUIRE",
    );
  const url = new URL(normalized);

  assert.equal(
    url.hostname,
    "ep-example-pooler.eu-central-1.aws.neon.tech",
  );
  assert.equal(
    url.pathname,
    "/neondb",
  );
  assert.deepEqual(
    url.searchParams.getAll("sslmode"),
    [
      "verify-full",
    ],
  );
  assert.equal(
    url.searchParams.get("channel_binding"),
    "require",
  );
});

test("normalizes intentionally local PostgreSQL connections to disabled TLS", () => {
  const normalized =
    normalizePostgresConnectionUrl(
      "postgresql://canaryguard:test-password@postgres:5432/canaryguard?sslmode=verify-full",
      "DISABLE",
    );
  const url = new URL(normalized);

  assert.deepEqual(
    url.searchParams.getAll("sslmode"),
    [
      "disable",
    ],
  );
});

test("requires both lifecycle migrations at startup", async () => {
  const completePool = {
    query: () => Promise.resolve({
      rows: [
        {
          version:
            "001_release_lifecycle",
        },
        {
          version:
            "002_deployment_event_ingestion",
        },
      ],
      rowCount: 2,
    }),
  } as unknown as Pool;

  await new PostgresReleaseLifecycleStore(
    completePool,
  ).verifySchema();

  const incompletePool = {
    query: () => Promise.resolve({
      rows: [
        {
          version:
            "001_release_lifecycle",
        },
      ],
      rowCount: 1,
    }),
  } as unknown as Pool;

  await assert.rejects(
    new PostgresReleaseLifecycleStore(
      incompletePool,
    ).verifySchema(),
    /Database migration 002_deployment_event_ingestion has not been applied\./u,
  );
});

test("cancels a closed pull request release and its pending automation", async () => {
  const statements: string[] = [];

  const pool = createPool(
    async (text) => {
      const sql = normalizeSql(text);
      statements.push(sql);

      if (sql.startsWith(
        "UPDATE repositories",
      )) {
        return {
          rows: [
            {
              repository_id: "41",
            },
          ],
        };
      }

      if (sql.startsWith(
        "INSERT INTO pull_requests",
      )) {
        return {
          rows: [
            {
              pull_request_id: "52",
              head_sha: headSha,
              state: "CLOSED",
            },
          ],
        };
      }

      if (sql.startsWith(
        "INSERT INTO releases",
      )) {
        return {
          rows: [
            {
              release_id: releaseId,
            },
          ],
        };
      }

      return {
        rows: [],
      };
    },
  );

  const store =
    new PostgresReleaseLifecycleStore(
      pool,
    );

  const result =
    await store.acceptPullRequestDelivery({
      deliveryId:
        "72d3162e-cc78-11e3-81ab-4c9367dc0958",
      payload:
        createPullRequestPayload(
          "closed",
        ),
    });

  assert.equal(result.releaseId, releaseId);
  assert.equal(
    statements.some((sql) =>
      sql.includes(
        "SET status = 'CANCELLED'",
      )),
    true,
  );
  assert.equal(
    statements.some((sql) =>
      sql.startsWith(
        "UPDATE automation_tasks",
      )
      && sql.includes(
        "WHERE release_id = $1",
      )),
    true,
  );
  assert.equal(
    statements.some((sql) =>
      sql.startsWith(
        "UPDATE deployment_attempts",
      )
      && sql.includes(
        "SET status = 'CANCELLED'",
      )),
    true,
  );
});

test("restores a reopened pull request release to pending", async () => {
  const statements: string[] = [];

  const pool = createPool(
    async (text) => {
      const sql = normalizeSql(text);
      statements.push(sql);

      if (sql.startsWith(
        "UPDATE repositories",
      )) {
        return {
          rows: [
            {
              repository_id: "41",
            },
          ],
        };
      }

      if (sql.startsWith(
        "INSERT INTO pull_requests",
      )) {
        return {
          rows: [
            {
              pull_request_id: "52",
              head_sha: headSha,
              state: "OPEN",
            },
          ],
        };
      }

      if (sql.startsWith(
        "INSERT INTO releases",
      )) {
        return {
          rows: [
            {
              release_id: releaseId,
            },
          ],
        };
      }

      return {
        rows: [],
      };
    },
  );

  const store =
    new PostgresReleaseLifecycleStore(
      pool,
    );

  await store.acceptPullRequestDelivery({
    deliveryId:
      "82d3162e-cc78-11e3-81ab-4c9367dc0958",
    payload:
      createPullRequestPayload(
        "reopened",
      ),
  });

  assert.equal(
    statements.some((sql) =>
      sql.includes(
        "SET status = 'PENDING'",
      )
      && sql.includes(
        "status = 'CANCELLED'",
      )),
    true,
  );
});

test("records and ignores a completed workflow for a closed pull request", async () => {
  const statements: string[] = [];

  const pool = createPool(
    async (text) => {
      const sql = normalizeSql(text);
      statements.push(sql);

      if (sql.startsWith(
        "UPDATE repositories",
      )) {
        return {
          rows: [
            {
              repository_id: "41",
            },
          ],
        };
      }

      if (
        sql.startsWith("SELECT")
        && sql.includes(
          "FROM pull_requests",
        )
      ) {
        return {
          rows: [
            {
              pull_request_id: "52",
              head_sha: headSha,
              state: "CLOSED",
            },
          ],
        };
      }

      return {
        rows: [],
      };
    },
  );

  const store =
    new PostgresReleaseLifecycleStore(
      pool,
    );

  const result =
    await store.acceptWorkflowRunDelivery({
      deliveryId:
        "92d3162e-cc78-11e3-81ab-4c9367dc0958",
      payload:
        createWorkflowRunPayload(),
    });

  assert.deepEqual(result, {
    status: "IGNORED",
    reason:
      "WORKFLOW_RUN_PULL_REQUEST_CLOSED",
  });
  assert.equal(
    statements.some((sql) =>
      sql.includes(
        "WORKFLOW_RUN_PULL_REQUEST_CLOSED",
      )),
    true,
  );
  assert.equal(
    statements.some((sql) =>
      sql.startsWith(
        "INSERT INTO automation_tasks",
      )),
    false,
  );
});
