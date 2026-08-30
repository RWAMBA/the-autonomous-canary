import {
  execFileSync,
} from "node:child_process";

import type {
  RoutingMode,
} from "../src/routing-mode.js";
import {
  readCanaryTrafficPercent,
  routingConfigForMode,
} from "../src/routing-mode.js";

function readRoutingMode(
  value: string | undefined,
): RoutingMode {
  const routingMode = value?.trim();

  if (
    routingMode !== "canary"
    && routingMode !== "promote"
    && routingMode !== "rollback"
  ) {
    throw new Error(
      "ROUTING_MODE must be canary, promote, or rollback.",
    );
  }

  return routingMode;
}

function runCommand(
  command: string,
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
): void {
  execFileSync(
    command,
    arguments_,
    {
      env: environment,
      stdio: "inherit",
    },
  );
}

const routingMode = readRoutingMode(
  process.env.ROUTING_MODE,
);

const canaryTrafficPercent =
  readCanaryTrafficPercent(
    process.env.CANARY_INITIAL_TRAFFIC_PERCENT,
  );

const routingConfig = routingConfigForMode(
  routingMode,
  canaryTrafficPercent,
);

runCommand(
  "docker",
  [
    "compose",
    "up",
    "--detach",
    "--no-build",
    "--no-deps",
    "--force-recreate",
    "--wait",
    "--wait-timeout",
    "60",
    "gateway",
  ],
  {
    ...process.env,
    ROUTING_CONFIG: routingConfig,
  },
);

runCommand(
  "npm",
  [
    "run",
    "verify:routing",
  ],
  {
    ...process.env,
    EXPECTED_ROUTING_MODE: routingMode,
    EXPECTED_CANARY_TRAFFIC_PERCENT:
      String(canaryTrafficPercent),
  },
);

console.log(
  `Routing mode applied and verified: ${routingMode} using ${routingConfig}.`,
);
