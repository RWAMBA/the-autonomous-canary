export type ReleaseChannel = "local" | "stable" | "canary";

export interface ReleaseMetadata {
  readonly channel: ReleaseChannel;
  readonly commitSha: string;
  readonly version: string;
}

function readValue(
  value: string | undefined,
  fallback: string,
): string {
  const normalized = value?.trim();

  if (normalized === undefined || normalized.length === 0) {
    return fallback;
  }

  return normalized;
}

function readChannel(value: string | undefined): ReleaseChannel {
  const channel = readValue(value, "local");

  if (
    channel !== "local"
    && channel !== "stable"
    && channel !== "canary"
  ) {
    throw new Error(
      `RELEASE_CHANNEL must be local, stable, or canary. Received: ${channel}`,
    );
  }

  return channel;
}

export function loadReleaseMetadata(
  environment: NodeJS.ProcessEnv = process.env,
): ReleaseMetadata {
  return Object.freeze({
    channel: readChannel(environment.RELEASE_CHANNEL),
    commitSha: readValue(
      environment.RENDER_GIT_COMMIT,
      readValue(environment.COMMIT_SHA, "development"),
    ),
    version: readValue(environment.APP_VERSION, "development"),
  });
}
