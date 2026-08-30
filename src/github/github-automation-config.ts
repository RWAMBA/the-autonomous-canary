export const githubAutomationProviderEnvironmentVariable =
  "CANARYGUARD_GITHUB_AUTOMATION_PROVIDER";

export const githubAutomationQueueCapacityEnvironmentVariable =
  "GITHUB_AUTOMATION_QUEUE_CAPACITY";

export const githubAutomationConcurrencyEnvironmentVariable =
  "GITHUB_AUTOMATION_CONCURRENCY";

export const defaultGitHubAutomationQueueCapacity =
  100;

export const minimumGitHubAutomationQueueCapacity =
  1;

export const maximumGitHubAutomationQueueCapacity =
  1_000;

export const defaultGitHubAutomationConcurrency =
  1;

export const minimumGitHubAutomationConcurrency =
  1;

export const maximumGitHubAutomationConcurrency =
  10;

export interface DisabledGitHubAutomationConfig {
  readonly provider: "DISABLED";
}

export interface EnabledGitHubAutomationConfig {
  readonly provider: "CHECKS";
  readonly queueCapacity: number;
  readonly concurrency: number;
}

export type GitHubAutomationConfig =
  | DisabledGitHubAutomationConfig
  | EnabledGitHubAutomationConfig;

function readBoundedInteger(
  environment: NodeJS.ProcessEnv,
  variableName: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const value = environment[variableName];

  if (value === undefined) {
    return defaultValue;
  }

  if (!/^[0-9]+$/u.test(value)) {
    throw new Error(
      `${variableName} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  const parsedValue = Number(value);

  if (
    !Number.isSafeInteger(parsedValue)
    || parsedValue < minimum
    || parsedValue > maximum
  ) {
    throw new Error(
      `${variableName} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  return parsedValue;
}

export function loadGitHubAutomationConfig(
  environment:
    NodeJS.ProcessEnv = process.env,
): GitHubAutomationConfig {
  const provider =
    environment[
      githubAutomationProviderEnvironmentVariable
    ]
    ?? "DISABLED";

  if (provider === "DISABLED") {
    return Object.freeze({
      provider: "DISABLED",
    });
  }

  if (provider !== "CHECKS") {
    throw new Error(
      `${githubAutomationProviderEnvironmentVariable} must be DISABLED or CHECKS.`,
    );
  }

  return Object.freeze({
    provider: "CHECKS",
    queueCapacity: readBoundedInteger(
      environment,
      githubAutomationQueueCapacityEnvironmentVariable,
      defaultGitHubAutomationQueueCapacity,
      minimumGitHubAutomationQueueCapacity,
      maximumGitHubAutomationQueueCapacity,
    ),
    concurrency: readBoundedInteger(
      environment,
      githubAutomationConcurrencyEnvironmentVariable,
      defaultGitHubAutomationConcurrency,
      minimumGitHubAutomationConcurrency,
      maximumGitHubAutomationConcurrency,
    ),
  });
}
