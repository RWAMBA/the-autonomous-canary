import assert from "node:assert/strict";
import type {
  IncomingMessage,
} from "node:http";
import {
  test,
} from "node:test";

import {
  HttpError,
} from "../../src/middleware/http-error.js";
import {
  createReviewApiKeyAuthenticator,
  loadReviewApiKey,
  minimumReviewApiKeyBytes,
  reviewApiKeyEnvironmentVariable,
} from "../../src/middleware/require-review-api-key.js";

const configuredApiKey =
  "a".repeat(
    minimumReviewApiKeyBytes,
  );

function createRequest(
  authorization?:
    | string
    | string[],
): IncomingMessage {
  return {
    headers:
      authorization === undefined
        ? {}
        : {
            authorization,
          },
  } as unknown as IncomingMessage;
}

function captureUnauthorizedError(
  operation: () => void,
): HttpError {
  let capturedError: unknown;

  try {
    operation();
  } catch (error) {
    capturedError = error;
  }

  assert.ok(
    capturedError instanceof HttpError,
  );

  assert.equal(
    capturedError.statusCode,
    401,
  );

  assert.equal(
    capturedError.code,
    "UNAUTHORIZED",
  );

  assert.equal(
    capturedError.message,
    "A valid bearer token is required.",
  );

  return capturedError;
}

test("loads a valid configured review API key", () => {
  const result = loadReviewApiKey({
    [reviewApiKeyEnvironmentVariable]:
      configuredApiKey,
  });

  assert.equal(
    result,
    configuredApiKey,
  );
});

test("rejects a missing configured API key", () => {
  assert.throws(
    () => loadReviewApiKey({}),
    {
      message:
        "CANARYGUARD_API_KEY must be configured.",
    },
  );
});

test("rejects a configured API key that is too short", () => {
  const shortKey =
    "a".repeat(
      minimumReviewApiKeyBytes - 1,
    );

  assert.throws(
    () => loadReviewApiKey({
      [reviewApiKeyEnvironmentVariable]:
        shortKey,
    }),
    {
      message:
        "CANARYGUARD_API_KEY must contain between 32 and 512 bytes.",
    },
  );
});

test("rejects ambiguous configured API keys", () => {
  assert.throws(
    () => loadReviewApiKey({
      [reviewApiKeyEnvironmentVariable]:
        ` ${configuredApiKey}`,
    }),
    {
      message:
        "CANARYGUARD_API_KEY must be a single non-whitespace token.",
    },
  );

  assert.throws(
    () => loadReviewApiKey({
      [reviewApiKeyEnvironmentVariable]:
        `${configuredApiKey},another-key`,
    }),
    {
      message:
        "CANARYGUARD_API_KEY must be a single non-whitespace token.",
    },
  );
});

test("accepts the correct bearer token", () => {
  const authenticate =
    createReviewApiKeyAuthenticator(
      configuredApiKey,
    );

  assert.doesNotThrow(
    () => authenticate(
      createRequest(
        `Bearer ${configuredApiKey}`,
      ),
    ),
  );

  assert.doesNotThrow(
    () => authenticate(
      createRequest(
        `bearer ${configuredApiKey}`,
      ),
    ),
  );
});

test("rejects missing malformed and duplicated credentials", () => {
  const authenticate =
    createReviewApiKeyAuthenticator(
      configuredApiKey,
    );

  captureUnauthorizedError(
    () => authenticate(
      createRequest(),
    ),
  );

  captureUnauthorizedError(
    () => authenticate(
      createRequest(
        `Basic ${configuredApiKey}`,
      ),
    ),
  );

  captureUnauthorizedError(
    () => authenticate(
      createRequest(
        `Bearer ${configuredApiKey} extra`,
      ),
    ),
  );

  captureUnauthorizedError(
    () => authenticate(
      createRequest([
        `Bearer ${configuredApiKey}`,
        `Bearer ${configuredApiKey}`,
      ]),
    ),
  );
});

test("rejects incorrect tokens without exposing comparison details", () => {
  const authenticate =
    createReviewApiKeyAuthenticator(
      configuredApiKey,
    );

  const sameLengthToken =
    "b".repeat(
      minimumReviewApiKeyBytes,
    );

  const differentLengthToken =
    "incorrect";

  const sameLengthError =
    captureUnauthorizedError(
      () => authenticate(
        createRequest(
          `Bearer ${sameLengthToken}`,
        ),
      ),
    );

  const differentLengthError =
    captureUnauthorizedError(
      () => authenticate(
        createRequest(
          `Bearer ${differentLengthToken}`,
        ),
      ),
    );

  assert.equal(
    sameLengthError.message,
    differentLengthError.message,
  );

  assert.equal(
    sameLengthError.message.includes(
      sameLengthToken,
    ),
    false,
  );

  assert.equal(
    differentLengthError.message.includes(
      differentLengthToken,
    ),
    false,
  );
});
