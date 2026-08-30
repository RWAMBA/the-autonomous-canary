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

const migrations = [
  {
    version: "001_release_lifecycle",
    url: new URL(
      "../db/migrations/001_release_lifecycle.sql",
      import.meta.url,
    ),
  },
  {
    version:
      "002_deployment_event_ingestion",
    url: new URL(
      "../db/migrations/002_deployment_event_ingestion.sql",
      import.meta.url,
    ),
  },
] as const;

const pool = createPostgresPool(config);
const client = await pool.connect();

try {
  await client.query(
    "SELECT pg_advisory_lock($1)",
    [
      1_548_624_771,
    ],
  );

  for (const migration of migrations) {
    await client.query(
      await readFile(
        migration.url,
        "utf8",
      ),
    );

    console.log(
      `Database migration ${migration.version} applied.`,
    );
  }
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
