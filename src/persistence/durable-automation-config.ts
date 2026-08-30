import {
  z,
} from "zod";

const boundedInteger = (
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
      z.number().int().min(minimum).max(maximum),
    ),
);

const durableAutomationConfigSchema = z
  .object({
    pollIntervalMs:
      boundedInteger(100, 60_000, 1_000),
    leaseMs:
      boundedInteger(10_000, 600_000, 60_000),
    maximumAttempts:
      boundedInteger(1, 10, 3),
    retryBaseMs:
      boundedInteger(100, 60_000, 5_000),
  })
  .strict();

export type DurableAutomationConfig =
  z.infer<
    typeof durableAutomationConfigSchema
  >;

export function loadDurableAutomationConfig(
  environment:
    NodeJS.ProcessEnv = process.env,
): DurableAutomationConfig {
  return Object.freeze(
    durableAutomationConfigSchema.parse({
      pollIntervalMs:
        environment.GITHUB_AUTOMATION_POLL_INTERVAL_MS,
      leaseMs:
        environment.GITHUB_AUTOMATION_LEASE_MS,
      maximumAttempts:
        environment.GITHUB_AUTOMATION_MAX_ATTEMPTS,
      retryBaseMs:
        environment.GITHUB_AUTOMATION_RETRY_BASE_MS,
    }),
  );
}
