import {
  readFile,
} from "node:fs/promises";

import {
  createPostgresPool,
} from "./persistence/postgres-release-lifecycle-store.js";
import {
  loadPersistenceConfig,
} from "./persistence/persistence-config.js";

const config = loadPersistenceConfig();

if (config.provider !== "POSTGRES") {
  throw new Error(
    "CANARYGUARD_PERSISTENCE_PROVIDER=POSTGRES is required to run database migrations.",
  );
}

const migrationUrl = new URL(
  "../db/migrations/001_release_lifecycle.sql",
  import.meta.url,
);

const migration = await readFile(
  migrationUrl,
  "utf8",
);

const pool = createPostgresPool(config);
const client = await pool.connect();

try {
  await client.query(
    "SELECT pg_advisory_lock($1)",
    [
      1_548_624_771,
    ],
  );

  await client.query(migration);

  console.log(
    "Database migration 001_release_lifecycle applied.",
  );
} finally {
  try {
    await client.query(
      "SELECT pg_advisory_unlock($1)",
      [
        1_548_624_771,
      ],
    );
  } finally {
    client.release();
    await pool.end();
  }
}
