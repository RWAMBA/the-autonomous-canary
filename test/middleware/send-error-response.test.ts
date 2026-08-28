import assert from "node:assert/strict";
import type {
  OutgoingHttpHeaders,
  ServerResponse,
} from "node:http";
import {
  test,
} from "node:test";

import {
  z,
  ZodError,
} from "zod";

import {
  HttpError,
} from "../../src/middleware/http-error.js";
import {
  maximumValidationIssues,
  sendErrorResponse,
} from "../../src/middleware/send-error-response.js";
import type {
  ErrorResponseBody,
} from "../../src/middleware/send-error-response.js";

interface CapturedResponse {
  statusCode?: number;
  headers?: OutgoingHttpHeaders;
  body?: string;
}

function createResponse(): {
  readonly response: ServerResponse;
  readonly captured: CapturedResponse;
} {
  const captured: CapturedResponse = {};

  const response = {
    setHeader(
      name: string,
      value: string,
    ) {
      captured.headers = {
        ...(captured.headers ?? {}),
        [name.toLowerCase()]: value,
      };

      return this;
    },
    writeHead(
      statusCode: number,
      headers: OutgoingHttpHeaders,
    ) {
      captured.statusCode = statusCode;
      captured.headers = {
        ...(captured.headers ?? {}),
        ...headers,
      };

      return this;
    },
    end(chunk?: unknown) {
      captured.body =
        chunk === undefined
          ? ""
          : String(chunk);

      return this;
    },
  } as unknown as ServerResponse;

  return {
    response,
    captured,
  };
}

function parseCapturedBody(
  captured: CapturedResponse,
): ErrorResponseBody {
  assert.ok(captured.body);

  return JSON.parse(
    captured.body,
  ) as ErrorResponseBody;
}

function captureZodError(
  operation: () => unknown,
): ZodError {
  let capturedError: unknown;

  try {
    operation();
  } catch (error) {
    capturedError = error;
  }

  assert.ok(
    capturedError instanceof ZodError,
  );

  return capturedError;
}

test("returns an exposed HTTP client error", () => {
  const {
    response,
    captured,
  } = createResponse();

  sendErrorResponse(
    response,
    new HttpError({
      statusCode: 413,
      code: "PAYLOAD_TOO_LARGE",
      message:
        "The submitted payload is too large.",
    }),
  );

  assert.equal(
    captured.statusCode,
    413,
  );

  assert.equal(
    captured.headers?.[
      "content-type"
    ],
    "application/json; charset=utf-8",
  );

  assert.equal(
    captured.headers?.[
      "cache-control"
    ],
    "no-store",
  );

  assert.deepEqual(
    parseCapturedBody(captured),
    {
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message:
          "The submitted payload is too large.",
      },
    },
  );
});

test("adds bearer authentication metadata to unauthorized errors", () => {
  const {
    response,
    captured,
  } = createResponse();

  sendErrorResponse(
    response,
    new HttpError({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message:
        "A valid bearer token is required.",
    }),
  );

  assert.equal(
    captured.statusCode,
    401,
  );

  assert.equal(
    captured.headers?.[
      "cache-control"
    ],
    "no-store",
  );

  assert.equal(
    captured.headers?.[
      "www-authenticate"
    ],
    'Bearer realm="canaryguard-reviews"',
  );

  assert.deepEqual(
    parseCapturedBody(captured),
    {
      error: {
        code: "UNAUTHORIZED",
        message:
          "A valid bearer token is required.",
      },
    },
  );
});

test("hides a non-exposed HTTP server error", () => {
  const {
    response,
    captured,
  } = createResponse();

  sendErrorResponse(
    response,
    new HttpError({
      statusCode: 503,
      code:
        "INTELLIGENCE_PROVIDER_FAILURE",
      message:
        "Provider returned private diagnostic data.",
      expose: false,
    }),
  );

  assert.equal(
    captured.statusCode,
    503,
  );

  const body =
    parseCapturedBody(captured);

  assert.deepEqual(body, {
    error: {
      code:
        "INTERNAL_SERVER_ERROR",
      message:
        "An unexpected server error occurred.",
    },
  });

  assert.equal(
    captured.body?.includes(
      "private diagnostic data",
    ),
    false,
  );
});

test("returns sanitized Zod validation issues", () => {
  const fakeSecret =
    "sk-proj-abcdefghijklmnopqrstuvwxyz123456";

  const validationError =
    captureZodError(() =>
      z
        .object({
          testStatus:
            z.literal("passed"),
        })
        .strict()
        .parse({
          testStatus: "failed",
          credential: fakeSecret,
        }),
    );

  const {
    response,
    captured,
  } = createResponse();

  sendErrorResponse(
    response,
    validationError,
  );

  assert.equal(
    captured.statusCode,
    400,
  );

  const body =
    parseCapturedBody(captured);

  assert.equal(
    body.error.code,
    "VALIDATION_ERROR",
  );

  assert.ok(
    body.error.issues,
  );

  assert.ok(
    body.error.issues.length > 0,
  );

  assert.equal(
    captured.body?.includes(
      fakeSecret,
    ),
    false,
  );

  for (
    const issue
    of body.error.issues
  ) {
    assert.deepEqual(
      Object.keys(issue).sort(),
      [
        "code",
        "path",
      ],
    );
  }
});

test("caps the number of validation issues", () => {
  const invalidValues =
    Array.from(
      {
        length:
          maximumValidationIssues + 10,
      },
      (_, index) =>
        `invalid-value-${index}`,
    );

  const validationError =
    captureZodError(() =>
      z
        .array(
          z.number(),
        )
        .parse(invalidValues),
    );

  const {
    response,
    captured,
  } = createResponse();

  sendErrorResponse(
    response,
    validationError,
  );

  const body =
    parseCapturedBody(captured);

  assert.equal(
    body.error.issues?.length,
    maximumValidationIssues,
  );

  assert.equal(
    captured.body?.includes(
      "invalid-value-29",
    ),
    false,
  );
});

test("returns a generic response for an unknown error", () => {
  const {
    response,
    captured,
  } = createResponse();

  sendErrorResponse(
    response,
    new Error(
      "Database password was exposed.",
    ),
  );

  assert.equal(
    captured.statusCode,
    500,
  );

  assert.deepEqual(
    parseCapturedBody(captured),
    {
      error: {
        code:
          "INTERNAL_SERVER_ERROR",
        message:
          "An unexpected server error occurred.",
      },
    },
  );

  assert.equal(
    captured.body?.includes(
      "Database password",
    ),
    false,
  );
});
