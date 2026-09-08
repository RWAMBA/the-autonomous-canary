import { readFile, writeFile } from "node:fs/promises";

import {
  normalizePhase7Observations,
  normalizeTrivySecretReport,
} from "../src/evidence/phase7-evidence-adapter.js";

const maximumInputBytes = 2 * 1_024 * 1_024;

function readArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0 || value === undefined || value.startsWith("--")) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function readEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

const inputPath = readArgument("--input");
const outputPath = readArgument("--output");
const source = readArgument("--source");
const input = await readFile(inputPath);

if (input.byteLength > maximumInputBytes) {
  throw new Error("The evidence input exceeds the supported size.");
}

const [owner, name, extra] = readEnvironment("GITHUB_REPOSITORY").split("/");
if (owner === undefined || name === undefined || extra !== undefined) {
  throw new Error("GITHUB_REPOSITORY is invalid.");
}

const baseContext = {
  repository: { owner, name },
  workflow: {
    runId: Number(readEnvironment("GITHUB_RUN_ID")),
    runAttempt: Number(readEnvironment("GITHUB_RUN_ATTEMPT")),
    headSha: readEnvironment("CANARYGUARD_EVIDENCE_HEAD_SHA"),
  },
  scannerVersion: readArgument("--scanner-version"),
  generatedAt: new Date().toISOString(),
};
const parsedInput = JSON.parse(input.toString("utf8")) as unknown;

const report = source === "TRIVY_SECRET"
  ? normalizeTrivySecretReport(parsedInput, baseContext)
  : source === "CANARYGUARD_EXPOSURE"
    ? normalizePhase7Observations(parsedInput, {
        ...baseContext,
        source,
        scanTarget: "DEPLOYED_EXPOSURE",
      })
    : source === "CANARYGUARD_AGENT_POLICY"
      ? normalizePhase7Observations(parsedInput, {
          ...baseContext,
          source,
          scanTarget: "AGENT_ACTION_POLICY",
        })
      : (() => { throw new Error("--source is invalid."); })();

await writeFile(outputPath, `${JSON.stringify(report)}\n`, {
  encoding: "utf8",
  flag: "wx",
});

console.log(
  `Normalized ${report.findings.length} ${report.source} finding(s); truncated=${report.truncated}.`,
);
