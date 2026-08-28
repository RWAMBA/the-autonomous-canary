import {
  z,
} from "zod";

import {
  intelligenceTelemetrySchema,
} from "./intelligence-engine.js";
import type {
  IntelligenceTelemetry,
} from "./intelligence-engine.js";

export const intelligenceTelemetryEvent =
  "canaryguard.intelligence.completed";

export const intelligenceTelemetryRecordSchema =
  z
    .object({
      event: z.literal(
        intelligenceTelemetryEvent,
      ),
      reviewId: z.uuid(),
      recordedAt: z.iso.datetime(),
      telemetry:
        intelligenceTelemetrySchema,
    })
    .strict();

export type IntelligenceTelemetryRecord =
  z.infer<
    typeof intelligenceTelemetryRecordSchema
  >;

export interface IntelligenceTelemetryLogInput {
  readonly reviewId: string;
  readonly telemetry:
    IntelligenceTelemetry;
}

export interface IntelligenceTelemetryLogger {
  log(
    input: IntelligenceTelemetryLogInput,
  ): void;
}

export type IntelligenceTelemetryWriter = (
  serializedRecord: string,
) => void;

export interface JsonIntelligenceTelemetryLoggerOptions {
  readonly now?: () => Date;
  readonly writer?:
    IntelligenceTelemetryWriter;
}

function defaultNow(): Date {
  return new Date();
}

function defaultWriter(
  serializedRecord: string,
): void {
  console.info(serializedRecord);
}

export function parseIntelligenceTelemetryRecord(
  input: unknown,
): IntelligenceTelemetryRecord {
  return intelligenceTelemetryRecordSchema.parse(
    input,
  );
}

export class JsonIntelligenceTelemetryLogger
implements IntelligenceTelemetryLogger {
  private readonly now: () => Date;

  private readonly writer:
    IntelligenceTelemetryWriter;

  constructor(
    options:
      JsonIntelligenceTelemetryLoggerOptions = {},
  ) {
    this.now = options.now ?? defaultNow;
    this.writer =
      options.writer ?? defaultWriter;
  }

  log(
    input: IntelligenceTelemetryLogInput,
  ): void {
    const record =
      parseIntelligenceTelemetryRecord({
        event:
          intelligenceTelemetryEvent,
        reviewId: input.reviewId,
        recordedAt:
          this.now().toISOString(),
        telemetry: input.telemetry,
      });

    this.writer(
      JSON.stringify(record),
    );
  }
}
