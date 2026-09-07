import assert from "node:assert/strict";
import {
  deflateRawSync,
} from "node:zlib";
import {
  test,
} from "node:test";

import {
  extractSingleArtifactFile,
} from "../../src/github/github-artifact-archive.js";

function createZip(
  files: readonly {
    readonly name: string;
    readonly content: string;
    readonly method?: 0 | 8;
  }[],
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const content = Buffer.from(
      file.content,
      "utf8",
    );
    const method = file.method ?? 0;
    const compressed = method === 8
      ? deflateRawSync(content)
      : content;
    const local = Buffer.alloc(30);

    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(
      compressed.length,
      18,
    );
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);

    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(
      compressed.length,
      20,
    );
    central.writeUInt32LE(
      content.length,
      24,
    );
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset +=
      local.length
      + name.length
      + compressed.length;
  }

  const centralDirectory =
    Buffer.concat(centralParts);
  const end = Buffer.alloc(22);

  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(
    centralDirectory.length,
    12,
  );
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([
    ...localParts,
    centralDirectory,
    end,
  ]);
}

test("extracts one bounded stored artifact file", () => {
  const result = extractSingleArtifactFile(
    createZip([
      {
        name:
          "canaryguard-trivy-evidence.json",
        content: "{\"ok\":true}",
      },
    ]),
    "canaryguard-trivy-evidence.json",
    1_024,
  );

  assert.equal(
    result.toString("utf8"),
    "{\"ok\":true}",
  );
});

test("extracts one bounded deflated artifact file", () => {
  const result = extractSingleArtifactFile(
    createZip([
      {
        name:
          "canaryguard-trivy-evidence.json",
        content: "{\"ok\":true}",
        method: 8,
      },
    ]),
    "canaryguard-trivy-evidence.json",
    1_024,
  );

  assert.equal(
    result.toString("utf8"),
    "{\"ok\":true}",
  );
});

test("rejects multiple files and unexpected names", () => {
  assert.throws(
    () => extractSingleArtifactFile(
      createZip([
        {
          name:
            "canaryguard-trivy-evidence.json",
          content: "{}",
        },
        {
          name: "extra.json",
          content: "{}",
        },
      ]),
      "canaryguard-trivy-evidence.json",
      1_024,
    ),
  );

  assert.throws(
    () => extractSingleArtifactFile(
      createZip([
        {
          name: "../evidence.json",
          content: "{}",
        },
      ]),
      "canaryguard-trivy-evidence.json",
      1_024,
    ),
  );
});

test("rejects an uncompressed file beyond the boundary", () => {
  assert.throws(
    () => extractSingleArtifactFile(
      createZip([
        {
          name:
            "canaryguard-trivy-evidence.json",
          content: "x".repeat(1_025),
          method: 8,
        },
      ]),
      "canaryguard-trivy-evidence.json",
      1_024,
    ),
  );
});
