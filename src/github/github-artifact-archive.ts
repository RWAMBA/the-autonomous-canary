import {
  inflateRawSync,
} from "node:zlib";

const endOfCentralDirectorySignature =
  0x06054b50;
const centralDirectorySignature =
  0x02014b50;
const localFileSignature = 0x04034b50;
const maximumZipCommentBytes = 65_535;

function requireRange(
  archive: Buffer,
  offset: number,
  length: number,
): void {
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || offset < 0
    || length < 0
    || offset + length > archive.length
  ) {
    throw new Error(
      "GitHub artifact archive is malformed.",
    );
  }
}

function findEndOfCentralDirectory(
  archive: Buffer,
): number {
  const minimumOffset = Math.max(
    0,
    archive.length
      - 22
      - maximumZipCommentBytes,
  );

  for (
    let offset = archive.length - 22;
    offset >= minimumOffset;
    offset -= 1
  ) {
    if (
      archive.readUInt32LE(offset)
      === endOfCentralDirectorySignature
    ) {
      return offset;
    }
  }

  throw new Error(
    "GitHub artifact archive has no central directory.",
  );
}

export function extractSingleArtifactFile(
  archive: Buffer,
  expectedFileName: string,
  maximumUncompressedBytes: number,
): Buffer {
  if (
    maximumUncompressedBytes <= 0
    || !Number.isSafeInteger(
      maximumUncompressedBytes,
    )
  ) {
    throw new Error(
      "Artifact extraction boundary is invalid.",
    );
  }

  requireRange(archive, 0, 22);

  const endOffset =
    findEndOfCentralDirectory(archive);

  requireRange(archive, endOffset, 22);

  const diskNumber =
    archive.readUInt16LE(endOffset + 4);
  const centralDiskNumber =
    archive.readUInt16LE(endOffset + 6);
  const diskEntries =
    archive.readUInt16LE(endOffset + 8);
  const totalEntries =
    archive.readUInt16LE(endOffset + 10);
  const centralSize =
    archive.readUInt32LE(endOffset + 12);
  const centralOffset =
    archive.readUInt32LE(endOffset + 16);
  const commentLength =
    archive.readUInt16LE(endOffset + 20);

  if (
    diskNumber !== 0
    || centralDiskNumber !== 0
    || diskEntries !== 1
    || totalEntries !== 1
    || endOffset + 22 + commentLength
      !== archive.length
  ) {
    throw new Error(
      "GitHub artifact archive must contain one file on one disk.",
    );
  }

  requireRange(
    archive,
    centralOffset,
    centralSize,
  );
  requireRange(archive, centralOffset, 46);

  if (
    archive.readUInt32LE(centralOffset)
    !== centralDirectorySignature
  ) {
    throw new Error(
      "GitHub artifact central directory is malformed.",
    );
  }

  const flags =
    archive.readUInt16LE(centralOffset + 8);
  const compressionMethod =
    archive.readUInt16LE(centralOffset + 10);
  const compressedSize =
    archive.readUInt32LE(centralOffset + 20);
  const uncompressedSize =
    archive.readUInt32LE(centralOffset + 24);
  const fileNameLength =
    archive.readUInt16LE(centralOffset + 28);
  const extraLength =
    archive.readUInt16LE(centralOffset + 30);
  const entryCommentLength =
    archive.readUInt16LE(centralOffset + 32);
  const entryDisk =
    archive.readUInt16LE(centralOffset + 34);
  const localOffset =
    archive.readUInt32LE(centralOffset + 42);
  const centralEntryLength =
    46
    + fileNameLength
    + extraLength
    + entryCommentLength;

  requireRange(
    archive,
    centralOffset,
    centralEntryLength,
  );

  if (
    centralEntryLength !== centralSize
    || entryDisk !== 0
    || (flags & 0x0001) !== 0
    || ![0, 8].includes(compressionMethod)
    || uncompressedSize
      > maximumUncompressedBytes
  ) {
    throw new Error(
      "GitHub artifact entry violates the extraction boundary.",
    );
  }

  const fileName = archive
    .subarray(
      centralOffset + 46,
      centralOffset + 46 + fileNameLength,
    )
    .toString("utf8");

  if (fileName !== expectedFileName) {
    throw new Error(
      "GitHub artifact contains an unexpected file.",
    );
  }

  requireRange(archive, localOffset, 30);

  if (
    archive.readUInt32LE(localOffset)
    !== localFileSignature
  ) {
    throw new Error(
      "GitHub artifact local entry is malformed.",
    );
  }

  const localFlags =
    archive.readUInt16LE(localOffset + 6);
  const localCompressionMethod =
    archive.readUInt16LE(localOffset + 8);
  const localFileNameLength =
    archive.readUInt16LE(localOffset + 26);
  const localExtraLength =
    archive.readUInt16LE(localOffset + 28);
  const dataOffset =
    localOffset
    + 30
    + localFileNameLength
    + localExtraLength;

  requireRange(
    archive,
    localOffset + 30,
    localFileNameLength
      + localExtraLength,
  );
  requireRange(
    archive,
    dataOffset,
    compressedSize,
  );

  const localFileName = archive
    .subarray(
      localOffset + 30,
      localOffset + 30 + localFileNameLength,
    )
    .toString("utf8");

  if (
    localFileName !== fileName
    || localFlags !== flags
    || localCompressionMethod
      !== compressionMethod
  ) {
    throw new Error(
      "GitHub artifact entry metadata is inconsistent.",
    );
  }

  const compressed = archive.subarray(
    dataOffset,
    dataOffset + compressedSize,
  );
  const output = compressionMethod === 0
    ? Buffer.from(compressed)
    : inflateRawSync(compressed, {
        maxOutputLength:
          maximumUncompressedBytes,
      });

  if (output.length !== uncompressedSize) {
    throw new Error(
      "GitHub artifact entry size is inconsistent.",
    );
  }

  return output;
}
