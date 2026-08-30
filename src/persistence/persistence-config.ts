import {
  z,
} from "zod";

export const persistenceProviderSchema =
  z.enum([
    "DISABLED",
    "POSTGRES",
  ]);

const databaseSslModeSchema = z.enum([
  "REQUIRE",
  "DISABLE",
]);

const postgresUrlSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine(
    (value) => value.trim() === value,
    "DATABASE_URL must not contain surrounding whitespace.",
  )
  .superRefine((value, context) => {
    try {
      const url = new URL(value);

      if (
        ![
          "postgres:",
          "postgresql:",
        ].includes(url.protocol)
        || url.username.length === 0
        || url.hostname.length === 0
        || url.pathname.length <= 1
        || url.hash.length > 0
      ) {
        context.addIssue({
          code: "custom",
          message:
            "DATABASE_URL must be a complete PostgreSQL connection URL.",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message:
          "DATABASE_URL must be a valid URL.",
      });
    }
  });

const integerEnvironmentSchema = (
  minimum: number,
  maximum: number,
  defaultValue: number,
) => z.preprocess(
  (value) => value ?? String(defaultValue),
  z
    .string()
    .regex(/^\d+$/u)
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(minimum)
        .max(maximum),
    ),
);

const enabledPostgresConfigSchema = z
  .object({
    provider: z.literal("POSTGRES"),
    databaseUrl: postgresUrlSchema,
    sslMode:
      databaseSslModeSchema,
    poolMaximum:
      integerEnvironmentSchema(
        1,
        20,
        5,
      ),
    connectionTimeoutMs:
      integerEnvironmentSchema(
        1_000,
        60_000,
        10_000,
      ),
    statementTimeoutMs:
      integerEnvironmentSchema(
        1_000,
        60_000,
        15_000,
      ),
  })
  .strict();

export type EnabledPostgresPersistenceConfig =
  z.infer<
    typeof enabledPostgresConfigSchema
  >;

export type PersistenceConfig =
  | {
      readonly provider: "DISABLED";
    }
  | EnabledPostgresPersistenceConfig;

export function loadPersistenceConfig(
  environment:
    NodeJS.ProcessEnv = process.env,
): PersistenceConfig {
  const provider =
    persistenceProviderSchema.parse(
      environment.CANARYGUARD_PERSISTENCE_PROVIDER
      ?? "DISABLED",
    );

  if (provider === "DISABLED") {
    return Object.freeze({
      provider,
    });
  }

  return Object.freeze(
    enabledPostgresConfigSchema.parse({
      provider,
      databaseUrl:
        environment.DATABASE_URL,
      sslMode:
        environment.DATABASE_SSL_MODE
        ?? "REQUIRE",
      poolMaximum:
        environment.DATABASE_POOL_MAXIMUM,
      connectionTimeoutMs:
        environment.DATABASE_CONNECTION_TIMEOUT_MS,
      statementTimeoutMs:
        environment.DATABASE_STATEMENT_TIMEOUT_MS,
    }),
  );
}
