import type {
  ServerResponse,
} from "node:http";

import {
  ZodError,
} from "zod";

import {
  isHttpError,
} from "./http-error.js";

export const maximumValidationIssues = 20;

export interface ValidationIssueResponse {
  readonly path: string;
  readonly code: string;
}

export interface ErrorResponseBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly issues?:
      readonly ValidationIssueResponse[];
  };
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: ErrorResponseBody,
): void {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type":
      "application/json; charset=utf-8",
  });

  response.end(
    JSON.stringify(body),
  );
}

function formatIssuePath(
  path: readonly PropertyKey[],
): string {
  if (path.length === 0) {
    return "$";
  }

  return path
    .map((segment) => String(segment))
    .join(".");
}

export function sendErrorResponse(
  response: ServerResponse,
  error: unknown,
): void {
  if (isHttpError(error)) {
    if (error.statusCode === 401) {
      response.setHeader(
        "www-authenticate",
        'Bearer realm="canaryguard-reviews"',
      );
    }

    if (error.expose) {
      sendJson(
        response,
        error.statusCode,
        {
          error: {
            code: error.code,
            message: error.message,
          },
        },
      );

      return;
    }

    sendJson(
      response,
      error.statusCode,
      {
        error: {
          code:
            "INTERNAL_SERVER_ERROR",
          message:
            "An unexpected server error occurred.",
        },
      },
    );

    return;
  }

  if (error instanceof ZodError) {
    const issues =
      error.issues
        .slice(
          0,
          maximumValidationIssues,
        )
        .map((issue) => ({
          path: formatIssuePath(
            issue.path,
          ),
          code: issue.code,
        }));

    sendJson(
      response,
      400,
      {
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Request payload failed validation.",
          issues,
        },
      },
    );

    return;
  }

  sendJson(
    response,
    500,
    {
      error: {
        code:
          "INTERNAL_SERVER_ERROR",
        message:
          "An unexpected server error occurred.",
      },
    },
  );
}
