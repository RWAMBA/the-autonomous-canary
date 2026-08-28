import assert from "node:assert/strict";
import type {
  IncomingHttpHeaders,
  IncomingMessage,
} from "node:http";
import {
  test,
} from "node:test";
import {
  PassThrough,
} from "node:stream";

import {
  HttpError,
} from "../../src/middleware/http-error.js";
import {
  readJsonBody,
} from "../../src/middleware/read-json-body.js";

type RequestStream = PassThrough & {
  headers: IncomingHttpHeaders;
};

function createRequestStream(
  headers: IncomingHttpHeaders,
): RequestStream {
  const request = new PassThrough() as RequestStream;
  request.headers = headers;

  return request;
}

function createRequest(
  body: string,
  headers: IncomingHttpHeaders,
): IncomingMessage {
  const request = createRequestStream(headers);

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

test("reads a valid JSON request body", async () => {
  const body = JSON.stringify({
    service: "CanaryGuard AI",
    enabled: true,
  });

  const result = await readJsonBody(
    createRequest(
      body,
      {
        "content-type": "application/json; charset=utf-8",
        "content-length": String(Buffer.byteLength(body)),
      },
    ),
  );

  assert.deepEqual(result, {
    service: "CanaryGuard AI",
    enabled: true,
  });
});

test("rejects an unsupported content type", () => {
  assert.throws(
    () => readJsonBody(
      createRequest(
        "{}",
        {
          "content-type": "text/plain",
        },
      ),
    ),
    (error: unknown) => assertExpectedHttpError(
      error,
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    ),
  );
});

test("rejects an invalid Content-Length", () => {
  assert.throws(
    () => readJsonBody(
      createRequest(
        "{}",
        {
          "content-type": "application/json",
          "content-length": "not-a-number",
        },
      ),
    ),
    (error: unknown) => assertExpectedHttpError(
      error,
      400,
      "INVALID_CONTENT_LENGTH",
    ),
  );
});

test("rejects a declared oversized body", () => {
  assert.throws(
    () => readJsonBody(
      createRequest(
        "{}",
        {
          "content-type": "application/json",
          "content-length": "11",
        },
      ),
      10,
    ),
    (error: unknown) => assertExpectedHttpError(
      error,
      413,
      "PAYLOAD_TOO_LARGE",
    ),
  );
});

test("rejects an actual oversized streamed body", async () => {
  await assert.rejects(
    readJsonBody(
      createRequest(
        JSON.stringify({
          value: "larger than ten bytes",
        }),
        {
          "content-type": "application/json",
        },
      ),
      10,
    ),
    (error: unknown) => assertExpectedHttpError(
      error,
      413,
      "PAYLOAD_TOO_LARGE",
    ),
  );
});

test("rejects malformed JSON", async () => {
  await assert.rejects(
    readJsonBody(
      createRequest(
        "{\"incomplete\":",
        {
          "content-type": "application/json",
        },
      ),
    ),
    (error: unknown) => assertExpectedHttpError(
      error,
      400,
      "INVALID_JSON",
    ),
  );
});

test("rejects an empty request body", async () => {
  await assert.rejects(
    readJsonBody(
      createRequest(
        "",
        {
          "content-type": "application/json",
        },
      ),
    ),
    (error: unknown) => assertExpectedHttpError(
      error,
      400,
      "INVALID_JSON",
    ),
  );
});

test("rejects an interrupted request body", async () => {
  const request = createRequestStream({
    "content-type": "application/json",
  });

  queueMicrotask(() => {
    request.emit("aborted");
  });

  await assert.rejects(
    readJsonBody(
      request as unknown as IncomingMessage,
    ),
    (error: unknown) => assertExpectedHttpError(
      error,
      400,
      "REQUEST_ABORTED",
    ),
  );
});

test("rejects a request stream error", async () => {
  const request = createRequestStream({
    "content-type": "application/json",
  });

  queueMicrotask(() => {
    request.emit(
      "error",
      new Error("Simulated transport failure."),
    );
  });

  await assert.rejects(
    readJsonBody(
      request as unknown as IncomingMessage,
    ),
    (error: unknown) => assertExpectedHttpError(
      error,
      400,
      "REQUEST_STREAM_ERROR",
    ),
  );
});

test("rejects an invalid maximum byte limit", () => {
  assert.throws(
    () => readJsonBody(
      createRequest(
        "{}",
        {
          "content-type": "application/json",
        },
      ),
      0,
    ),
    {
      name: "RangeError",
    },
  );
});
