import {
  readCanaryTrafficPercent,
  type CanaryTrafficPercent,
  type RoutingMode,
} from "../src/routing-mode.js";

type ReleaseChannel = "stable" | "canary";

const gatewayUrl =
  process.env.GATEWAY_URL ?? "http://127.0.0.1:8080";

const sampleSize = readSampleSize(
  process.env.ROUTING_SAMPLE_SIZE,
);

const expectedRoutingMode = readRoutingMode(
  process.env.EXPECTED_ROUTING_MODE,
);

const expectedCanaryTrafficPercent =
  readCanaryTrafficPercent(
    process.env
      .EXPECTED_CANARY_TRAFFIC_PERCENT,
  );

function readSampleSize(value: string | undefined): number {
  const sampleSize = Number(value ?? "20");

  if (!Number.isInteger(sampleSize) || sampleSize < 10) {
    throw new Error(
      "ROUTING_SAMPLE_SIZE must be an integer of at least 10.",
    );
  }

  return sampleSize;
}

function readRoutingMode(
  value: string | undefined,
): RoutingMode {
  const routingMode = value?.trim() || "canary";

  if (
    routingMode !== "canary"
    && routingMode !== "promote"
    && routingMode !== "rollback"
  ) {
    throw new Error(
      "EXPECTED_ROUTING_MODE must be canary, promote, or rollback.",
    );
  }

  return routingMode;
}

async function requestJson(pathname: string): Promise<unknown> {
  const response = await fetch(
    new URL(pathname, gatewayUrl),
  );

  if (!response.ok) {
    throw new Error(
      `${pathname} returned HTTP ${response.status}.`,
    );
  }

  return response.json();
}

function verifyHealth(payload: unknown): void {
  if (
    typeof payload !== "object"
    || payload === null
    || !("status" in payload)
    || payload.status !== "ok"
  ) {
    throw new Error(
      "Gateway health response did not report status ok.",
    );
  }
}

function readChannel(payload: unknown): ReleaseChannel {
  if (
    typeof payload !== "object"
    || payload === null
    || !("release" in payload)
  ) {
    throw new Error(
      "Version response does not contain release metadata.",
    );
  }

  const release = payload.release;

  if (
    typeof release !== "object"
    || release === null
    || !("channel" in release)
  ) {
    throw new Error(
      "Version response does not contain a release channel.",
    );
  }

  if (
    release.channel !== "stable"
    && release.channel !== "canary"
  ) {
    throw new Error(
      `Unexpected release channel: ${String(release.channel)}`,
    );
  }

  return release.channel;
}

function verifyRouting(
  routingMode: RoutingMode,
  counts: Record<ReleaseChannel, number>,
  canaryTrafficPercent:
    CanaryTrafficPercent,
): void {
  if (routingMode === "canary") {
    const expectedCanaryRequests =
      sampleSize
      * canaryTrafficPercent
      / 100;

    if (!Number.isInteger(expectedCanaryRequests)) {
      throw new Error(
        "ROUTING_SAMPLE_SIZE must produce an integer expected canary count.",
      );
    }

    if (
      counts.canary !== expectedCanaryRequests
      || counts.stable
        !== sampleSize
          - expectedCanaryRequests
    ) {
      throw new Error(
        `Canary routing expected ${canaryTrafficPercent}% traffic but received ${
          counts.canary / sampleSize * 100
        }%.`,
      );
    }

    return;
  }

  const expectedChannel: ReleaseChannel =
    routingMode === "promote"
      ? "canary"
      : "stable";

  const unexpectedChannel: ReleaseChannel =
    expectedChannel === "canary"
      ? "stable"
      : "canary";

  if (
    counts[expectedChannel] !== sampleSize
    || counts[unexpectedChannel] !== 0
  ) {
    throw new Error(
      `${routingMode} mode expected all traffic to reach ${
        expectedChannel
      }.`,
    );
  }
}

verifyHealth(await requestJson("/health"));

const counts: Record<ReleaseChannel, number> = {
  stable: 0,
  canary: 0,
};

for (let request = 0; request < sampleSize; request += 1) {
  const channel = readChannel(
    await requestJson("/version"),
  );

  counts[channel] += 1;
}

const canaryShare = counts.canary / sampleSize;

console.log(JSON.stringify({
  gatewayUrl,
  expectedRoutingMode,
  expectedCanaryTrafficPercent,
  sampleSize,
  counts,
  canaryPercentage: canaryShare * 100,
}, null, 2));

verifyRouting(
  expectedRoutingMode,
  counts,
  expectedCanaryTrafficPercent,
);

console.log(
  `Routing verification passed for ${expectedRoutingMode} mode.`,
);
