import assert from "node:assert/strict";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
} from "node:http";
import {
  PassThrough,
} from "node:stream";
import {
  test,
} from "node:test";

import {
  HttpError,
} from "../../src/middleware/http-error.js";
import {
  readRawBody,
} from "../../src/middleware/read-raw-body.js";

type RequestStream = PassThrough & {
  headers: IncomingHttpHeaders;
};

function createRequestStream(
  headers: IncomingHttpHeaders,
): RequestStream {
  const request =
    new PassThrough() as RequestStream;
  request.headers = headers;

  return request;
}

function createRequest(
  body: Buffer | string,
  headers: IncomingHttpHeaders,
): IncomingMessage {
  const request =
    createRequestStream(headers);

  queueMicrotask(() => {
    request.end(body);
  });

  return request as unknown as IncomingMessage;
}

function assertExpectedHttpError(
  error: unknown,
  statusCode: number,
  code: string,
): boolean {
  assert.ok(error instanceof HttpError);
  assert.equal(error.statusCode, statusCode);
  assert.equal(error.code, code);

  return true;
}

test("preserves the exact raw JSON bytes used for signature validation", async () => {
  const body = Buffer.from(
    "{\n  \"unicode\": \"canary 🐤\"\n}\n",
    "utf8",
  );

  const result = await readRawBody(
    createRequest(
      body,
      {
        "content-type":
          "application/json; charset=utf-8",
        "content-length":
          String(body.byteLength),
      },
    ),
  );

  assert.deepEqual(result, body);
});

test("rejects unsupported content and invalid length metadata", () => {
  assert.throws(
    () => readRawBody(
      createRequest(
        "{}",
        {
          "content-type":
            "application/x-www-form-urlencoded",
        },
      ),
    ),
    (error: unknown) =>
      assertExpectedHttpError(
        error,
        415,
        "UNSUPPORTED_MEDIA_TYPE",
      ),
  );

  assert.throws(
    () => readRawBody(
      createRequest(
        "{}",
        {
          "content-type":
            "application/json",
          "content-length": "invalid",
        },
      ),
    ),
    (error: unknown) =>
      assertExpectedHttpError(
        error,
        400,
        "INVALID_CONTENT_LENGTH",
      ),
  );
});

test("rejects declared and streamed bodies above the configured boundary", async () => {
  assert.throws(
    () => readRawBody(
      createRequest(
        "{}",
        {
          "content-type":
            "application/json",
          "content-length": "11",
        },
      ),
      10,
    ),
    (error: unknown) =>
      assertExpectedHttpError(
        error,
        413,
        "PAYLOAD_TOO_LARGE",
      ),
  );

  await assert.rejects(
    readRawBody(
      createRequest(
        "larger than ten bytes",
        {
          "content-type":
            "application/json",
        },
      ),
      10,
    ),
    (error: unknown) =>
      assertExpectedHttpError(
        error,
        413,
        "PAYLOAD_TOO_LARGE",
      ),
  );
});

test("rejects interrupted and failed request streams", async () => {
  const aborted = createRequestStream({
    "content-type": "application/json",
  });

  queueMicrotask(() => {
    aborted.emit("aborted");
  });

  await assert.rejects(
    readRawBody(
      aborted as unknown as IncomingMessage,
    ),
    (error: unknown) =>
      assertExpectedHttpError(
        error,
        400,
        "REQUEST_ABORTED",
      ),
  );

  const failed = createRequestStream({
    "content-type": "application/json",
  });

  queueMicrotask(() => {
    failed.emit(
      "error",
      new Error("Simulated failure."),
    );
  });

  await assert.rejects(
    readRawBody(
      failed as unknown as IncomingMessage,
    ),
    (error: unknown) =>
      assertExpectedHttpError(
        error,
        400,
        "REQUEST_STREAM_ERROR",
      ),
  );
});

test("rejects an invalid maximum raw-body limit", () => {
  assert.throws(
    () => readRawBody(
      createRequest(
        "{}",
        {
          "content-type":
            "application/json",
        },
      ),
      0,
    ),
    {
      name: "RangeError",
    },
  );
});
