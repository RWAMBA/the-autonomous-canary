import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  inspectAgentActionPolicies,
} from "../src/evidence/agent-action-policy-evidence.js";

const outputIndex = process.argv.indexOf("--output");
const outputPath = process.argv[outputIndex + 1];
if (outputIndex < 0 || outputPath === undefined || outputPath.startsWith("--")) {
  throw new Error("--output is required.");
}

const workflowDirectory = ".github/workflows";
const entries = await readdir(workflowDirectory, { withFileTypes: true });
const files = entries
  .filter((entry) => entry.isFile() && /\.ya?ml$/u.test(entry.name))
  .map((entry) => join(workflowDirectory, entry.name))
  .sort();
const findings = inspectAgentActionPolicies(
  await Promise.all(files.map(async (path) => ({
    path,
    content: await readFile(path, "utf8"),
  }))),
);

await writeFile(outputPath, `${JSON.stringify(findings)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
console.log(`Detected ${findings.length} agent-action policy violation(s).`);
