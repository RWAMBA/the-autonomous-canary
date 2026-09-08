import {
  readFile,
  writeFile,
} from "node:fs/promises";

import {
  normalizeTrivyReport,
} from "../src/evidence/trivy-evidence-adapter.js";

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
const scanTargetInput = readArgument(
  "--scan-target",
);

if (
  scanTargetInput !== "FILESYSTEM"
  && scanTargetInput !== "CONTAINER_IMAGE"
) {
  throw new Error("--scan-target is invalid.");
}

const scanTarget = scanTargetInput;
const input = await readFile(inputPath);

if (input.byteLength > maximumInputBytes) {
  throw new Error("The Trivy report exceeds the supported size.");
}

const repository = readEnvironment("GITHUB_REPOSITORY").split("/");
const repositoryOwner = repository[0];
const repositoryName = repository[1];

if (
  repository.length !== 2
  || repositoryOwner === undefined
  || repositoryName === undefined
) {
  throw new Error("GITHUB_REPOSITORY is invalid.");
}

const report = normalizeTrivyReport(
  JSON.parse(input.toString("utf8")) as unknown,
  {
    repository: {
      owner: repositoryOwner,
      name: repositoryName,
    },
    workflow: {
      runId: Number(readEnvironment("GITHUB_RUN_ID")),
      runAttempt: Number(readEnvironment("GITHUB_RUN_ATTEMPT")),
      headSha: readEnvironment("CANARYGUARD_EVIDENCE_HEAD_SHA"),
    },
    scanTarget,
    generatedAt: new Date().toISOString(),
  },
);

await writeFile(
  outputPath,
  `${JSON.stringify(report)}\n`,
  {
    encoding: "utf8",
    flag: "wx",
  },
);

console.log(
  `Normalized ${report.findings.length} Trivy finding(s); truncated=${report.truncated}.`,
);
