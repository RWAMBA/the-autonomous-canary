import {
  createHash,
  timingSafeEqual,
} from "node:crypto";
import type {
  IncomingMessage,
} from "node:http";

import {
  HttpError,
} from "./http-error.js";

export const reviewApiKeyEnvironmentVariable =
  "CANARYGUARD_API_KEY";

export const minimumReviewApiKeyBytes = 32;
export const maximumReviewApiKeyBytes = 512;

export type ReviewApiKeyAuthenticator = (
  request: IncomingMessage,
) => void;

function validateConfiguredApiKey(
  value: string | undefined,
): string {
  if (value === undefined) {
    throw new Error(
      `${reviewApiKeyEnvironmentVariable} must be configured.`,
    );
  }

  if (
    value.length === 0
    || value.trim() !== value
    || /[\s,]/.test(value)
  ) {
    throw new Error(
      `${reviewApiKeyEnvironmentVariable} must be a single non-whitespace token.`,
    );
  }

  const byteLength =
    Buffer.byteLength(
      value,
      "utf8",
    );

  if (
    byteLength
      < minimumReviewApiKeyBytes
    || byteLength
      > maximumReviewApiKeyBytes
  ) {
    throw new Error(
      `${reviewApiKeyEnvironmentVariable} must contain between ${minimumReviewApiKeyBytes} and ${maximumReviewApiKeyBytes} bytes.`,
    );
  }

  return value;
}

function createDigest(
  value: string,
): Buffer {
  return createHash("sha256")
    .update(value, "utf8")
    .digest();
}

function createUnauthorizedError(): HttpError {
  return new HttpError({
    statusCode: 401,
    code: "UNAUTHORIZED",
    message:
      "A valid bearer token is required.",
  });
}

function readBearerToken(
  request: IncomingMessage,
): string {
  const authorization =
    request.headers.authorization;

  if (
    typeof authorization
    !== "string"
  ) {
    throw createUnauthorizedError();
  }

  const match =
    /^Bearer ([^\s,]+)$/i.exec(
      authorization,
    );

  const token = match?.[1];

  if (token === undefined) {
    throw createUnauthorizedError();
  }

  return token;
}

export function loadReviewApiKey(
  environment:
    NodeJS.ProcessEnv = process.env,
): string {
  return validateConfiguredApiKey(
    environment[
      reviewApiKeyEnvironmentVariable
    ],
  );
}

export function createReviewApiKeyAuthenticator(
  configuredApiKey: string,
): ReviewApiKeyAuthenticator {
  const validatedApiKey =
    validateConfiguredApiKey(
      configuredApiKey,
    );

  const expectedDigest =
    createDigest(validatedApiKey);

  return (
    request: IncomingMessage,
  ): void => {
    const suppliedToken =
      readBearerToken(request);

    const suppliedDigest =
      createDigest(suppliedToken);

    if (
      !timingSafeEqual(
        expectedDigest,
        suppliedDigest,
      )
    ) {
      throw createUnauthorizedError();
    }
  };
}
