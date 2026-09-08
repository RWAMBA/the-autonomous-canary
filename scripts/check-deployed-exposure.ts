import { writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import {
  evaluateDeployedExposure,
} from "../src/evidence/deployed-exposure-evidence.js";

function readArgument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0 || value === undefined || value.startsWith("--")) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

const baseUrl = new URL(readArgument("--base-url"));
const outputPath = readArgument("--output");
if (!/^https?:$/u.test(baseUrl.protocol)) {
  throw new Error("--base-url must use HTTP or HTTPS.");
}

const timeoutMs = 10_000;
const requestStatus = async (path: string, method: string): Promise<number> => {
  const url = new URL(path, baseUrl);
  const implementation = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const request = implementation(url, {
      method,
      timeout: timeoutMs,
      headers: { connection: "close" },
    }, (response) => {
      const status = response.statusCode;
      response.resume();
      status === undefined
        ? reject(new Error("Exposure probe received no HTTP status."))
        : resolve(status);
    });
    request.once("timeout", () =>
      request.destroy(new Error("Exposure probe timed out.")),
    );
    request.once("error", reject);
    request.end();
  });
};

const managementStatus = await requestStatus(
  "/management/releases?repositoryOwner=RWAMBA&repositoryName=the-autonomous-canary&limit=1",
  "GET",
);

const traceStatus = await requestStatus("/", "TRACE");
const findings = evaluateDeployedExposure({ managementStatus, traceStatus });

await writeFile(outputPath, `${JSON.stringify(findings)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
console.log(`Detected ${findings.length} deployed exposure(s).`);
