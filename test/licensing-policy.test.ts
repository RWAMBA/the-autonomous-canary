import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const copyrightNotice = readFileSync(
  new URL("../COPYRIGHT", import.meta.url),
  "utf8",
);
const readme = readFileSync(
  new URL("../README.md", import.meta.url),
  "utf8",
);
const packageMetadata = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

test("declares the proprietary all-rights-reserved licensing position", () => {
  assert.equal(
    copyrightNotice,
    "Copyright © 2026 Valerie Rwamba Munyi.\nAll rights reserved.\n",
  );
  assert.match(readme, /## Licensing/u);
  assert.match(readme, /CanaryGuard is proprietary software/u);
  assert.match(readme, /No open-source license is granted/u);
  assert.equal(packageMetadata.private, true);
  assert.equal(Object.hasOwn(packageMetadata, "license"), false);
});
