import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import {
  loadPersistenceConfig,
} from "../../src/persistence/persistence-config.js";

test("keeps persistence disabled by default without requiring a database credential", () => {
  assert.deepEqual(
    loadPersistenceConfig({}),
    {
      provider: "DISABLED",
    },
  );
});

test("loads bounded PostgreSQL connection controls", () => {
  assert.deepEqual(
    loadPersistenceConfig({
      CANARYGUARD_PERSISTENCE_PROVIDER:
        "POSTGRES",
      DATABASE_URL:
        "postgresql://canaryguard:secret@database.example/canaryguard",
    }),
    {
      provider: "POSTGRES",
      databaseUrl:
        "postgresql://canaryguard:secret@database.example/canaryguard",
      sslMode: "REQUIRE",
      poolMaximum: 5,
      connectionTimeoutMs: 10_000,
      statementTimeoutMs: 15_000,
    },
  );
});

test("rejects invalid PostgreSQL configuration without reproducing credentials", () => {
  const credential =
    "database-password-must-remain-private";

  assert.throws(
    () => loadPersistenceConfig({
      CANARYGUARD_PERSISTENCE_PROVIDER:
        "POSTGRES",
      DATABASE_URL:
        `https://user:${credential}@example.com/database`,
    }),
    (error: unknown) => {
      assert.equal(
        String(error).includes(credential),
        false,
      );
      return true;
    },
  );

  assert.throws(
    () => loadPersistenceConfig({
      CANARYGUARD_PERSISTENCE_PROVIDER:
        "POSTGRES",
      DATABASE_URL:
        "postgresql://user:secret@example.com/database",
      DATABASE_POOL_MAXIMUM: "0",
    }),
  );
});
