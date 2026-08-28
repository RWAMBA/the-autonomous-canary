import assert from "node:assert/strict";
import {
  test,
} from "node:test";

import type {
  IntelligenceTelemetry,
} from "../../src/engines/intelligence/intelligence-engine.js";
import {
  intelligenceTelemetryEvent,
  JsonIntelligenceTelemetryLogger,
  parseIntelligenceTelemetryRecord,
} from "../../src/engines/intelligence/intelligence-telemetry.js";

const reviewId =
  "123e4567-e89b-42d3-a456-426614174000";

const telemetry:
  IntelligenceTelemetry = {
    provider: "MOCK",
    modelTarget: "mock-canaryguard-v1",
    promptVersion: "canaryguard-review-v1",
    inputTokens: 15,
    outputTokens: 5,
    totalTokens: 20,
    latencyMs: 25.5,
    attempts: 1,
  };

test("writes a structured JSON telemetry record", () => {
  const writtenRecords: string[] = [];

  const logger =
    new JsonIntelligenceTelemetryLogger({
      now: () =>
        new Date(
          "2026-08-28T08:30:00.000Z",
        ),
      writer: (serializedRecord) => {
        writtenRecords.push(
          serializedRecord,
        );
      },
    });

  logger.log({
    reviewId,
    telemetry,
  });

  assert.equal(
    writtenRecords.length,
    1,
  );

  const serializedRecord =
    writtenRecords[0];

  assert.ok(serializedRecord);

  const record =
    parseIntelligenceTelemetryRecord(
      JSON.parse(serializedRecord),
    );

  assert.deepEqual(record, {
    event:
      intelligenceTelemetryEvent,
    reviewId,
    recordedAt:
      "2026-08-28T08:30:00.000Z",
    telemetry,
  });
});

test("telemetry output excludes request and model content", () => {
  let serializedRecord = "";

  const logger =
    new JsonIntelligenceTelemetryLogger({
      now: () =>
        new Date(
          "2026-08-28T08:30:00.000Z",
        ),
      writer: (value) => {
        serializedRecord = value;
      },
    });

  logger.log({
    reviewId,
    telemetry,
  });

  assert.equal(
    serializedRecord.includes("diff"),
    false,
  );

  assert.equal(
    serializedRecord.includes(
      "rawModelOutput",
    ),
    false,
  );

  assert.equal(
    serializedRecord.includes(
      "promptContent",
    ),
    false,
  );

  assert.equal(
    serializedRecord.includes(
      "OPENAI_API_KEY",
    ),
    false,
  );
});

test("rejects unauthorized telemetry fields", () => {
  assert.throws(
    () =>
      parseIntelligenceTelemetryRecord({
        event:
          intelligenceTelemetryEvent,
        reviewId,
        recordedAt:
          "2026-08-28T08:30:00.000Z",
        telemetry,
        diff:
          "+const password = 'secret';",
      }),
  );

  assert.throws(
    () =>
      parseIntelligenceTelemetryRecord({
        event:
          intelligenceTelemetryEvent,
        reviewId,
        recordedAt:
          "2026-08-28T08:30:00.000Z",
        telemetry: {
          ...telemetry,
          rawModelOutput: {
            decision: "CONTINUE",
          },
        },
      }),
  );
});

test("rejects an invalid review identifier", () => {
  assert.throws(
    () =>
      parseIntelligenceTelemetryRecord({
        event:
          intelligenceTelemetryEvent,
        reviewId: "not-a-uuid",
        recordedAt:
          "2026-08-28T08:30:00.000Z",
        telemetry,
      }),
  );
});

test("rejects an invalid telemetry timestamp", () => {
  assert.throws(
    () =>
      parseIntelligenceTelemetryRecord({
        event:
          intelligenceTelemetryEvent,
        reviewId,
        recordedAt: "yesterday",
        telemetry,
      }),
  );
});

test("rejects an invalid clock value before writing", () => {
  let writerCalled = false;

  const logger =
    new JsonIntelligenceTelemetryLogger({
      now: () => new Date("invalid"),
      writer: () => {
        writerCalled = true;
      },
    });

  assert.throws(
    () => logger.log({
      reviewId,
      telemetry,
    }),
    {
      name: "RangeError",
    },
  );

  assert.equal(
    writerCalled,
    false,
  );
});
