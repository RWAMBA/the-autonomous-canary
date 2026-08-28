import type {
  IncomingMessage,
} from "node:http";

import {
  HttpError,
} from "./http-error.js";

export const maximumJsonBodyBytes = 256 * 1_024;

type HeaderValue = string | string[] | undefined;

function firstHeaderValue(
  value: HeaderValue,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function validateContentType(
  request: IncomingMessage,
): void {
  const contentType = firstHeaderValue(
    request.headers["content-type"],
  );

  const mediaType = contentType
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();

  if (mediaType !== "application/json") {
    throw new HttpError({
      statusCode: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Content-Type must be application/json.",
    });
  }
}

function validateContentLength(
  request: IncomingMessage,
  maximumBytes: number,
): void {
  const value = firstHeaderValue(
    request.headers["content-length"],
  );

  if (value === undefined) {
    return;
  }

  const normalized = value.trim();

  if (!/^\d+$/.test(normalized)) {
    throw new HttpError({
      statusCode: 400,
      code: "INVALID_CONTENT_LENGTH",
      message: "Content-Length must be a non-negative integer.",
    });
  }

  const contentLength = Number(normalized);

  if (!Number.isSafeInteger(contentLength)) {
    throw new HttpError({
      statusCode: 400,
      code: "INVALID_CONTENT_LENGTH",
      message: "Content-Length is outside the supported range.",
    });
  }

  if (contentLength > maximumBytes) {
    throw new HttpError({
      statusCode: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: `Request body must not exceed ${maximumBytes} bytes.`,
    });
  }
}

export function readJsonBody(
  request: IncomingMessage,
  maximumBytes: number = maximumJsonBodyBytes,
): Promise<unknown> {
  if (
    !Number.isSafeInteger(maximumBytes)
    || maximumBytes < 1
  ) {
    throw new RangeError(
      "maximumBytes must be a positive safe integer.",
    );
  }

  validateContentType(request);
  validateContentLength(
    request,
    maximumBytes,
  );

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let receivedBytes = 0;

    const cleanup = (): void => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("aborted", onAborted);
      request.off("error", onError);
    };

    const onData = (
      chunk: Buffer | string,
    ): void => {
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk);

      receivedBytes += buffer.byteLength;

      if (receivedBytes > maximumBytes) {
        cleanup();
        request.resume();

        reject(new HttpError({
          statusCode: 413,
          code: "PAYLOAD_TOO_LARGE",
          message: `Request body must not exceed ${maximumBytes} bytes.`,
        }));

        return;
      }

      chunks.push(buffer);
    };

    const onEnd = (): void => {
      cleanup();

      if (receivedBytes === 0) {
        reject(new HttpError({
          statusCode: 400,
          code: "INVALID_JSON",
          message: "Request body must contain valid JSON.",
        }));

        return;
      }

      try {
        const body = Buffer
          .concat(chunks, receivedBytes)
          .toString("utf8");

        resolve(JSON.parse(body));
      } catch (error) {
        reject(new HttpError({
          statusCode: 400,
          code: "INVALID_JSON",
          message: "Request body must contain valid JSON.",
          cause: error,
        }));
      }
    };

    const onAborted = (): void => {
      cleanup();

      reject(new HttpError({
        statusCode: 400,
        code: "REQUEST_ABORTED",
        message: "Request body transmission was interrupted.",
      }));
    };

    const onError = (
      error: Error,
    ): void => {
      cleanup();

      reject(new HttpError({
        statusCode: 400,
        code: "REQUEST_STREAM_ERROR",
        message: "Request body could not be read.",
        cause: error,
      }));
    };

    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAborted);
    request.once("error", onError);
  });
}
