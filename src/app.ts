import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

import {
  DefaultReviewController,
} from "./controllers/review-controller.js";
import type {
  ReviewController,
} from "./controllers/review-controller.js";
import {
  createFailureSimulator,
} from "./failure-simulator.js";
import type {
  FailureSimulator,
} from "./failure-simulator.js";
import {
  HttpError,
} from "./middleware/http-error.js";
import {
  readJsonBody,
} from "./middleware/read-json-body.js";
import type {
  ReviewApiKeyAuthenticator,
} from "./middleware/require-review-api-key.js";
import {
  sendErrorResponse,
} from "./middleware/send-error-response.js";
import type {
  ReleaseMetadata,
} from "./release.js";

const serviceName =
  "the-autonomous-canary";

export interface RequestHandlerOptions {
  readonly reviewController?:
    ReviewController;
  readonly authenticateReviewRequest?:
    ReviewApiKeyAuthenticator;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type":
      "application/json; charset=utf-8",
  });

  response.end(
    JSON.stringify(body),
  );
}

const rejectUnavailableReviewRequest:
  ReviewApiKeyAuthenticator = () => {
    throw new HttpError({
      statusCode: 503,
      code: "REVIEW_API_UNAVAILABLE",
      message:
        "The review API is not configured.",
      expose: false,
    });
  };

async function handleReviewRequest(
  request: IncomingMessage,
  response: ServerResponse,
  reviewController: ReviewController,
  authenticateReviewRequest:
    ReviewApiKeyAuthenticator,
): Promise<void> {
  try {
    /*
     * Authentication happens before the body is read.
     * Unauthorized callers cannot consume validation,
     * sanitization, policy, or intelligence resources.
     */
    authenticateReviewRequest(request);

    const input =
      await readJsonBody(request);

    const review =
      await reviewController.createReview(
        input,
      );

    response.setHeader(
      "cache-control",
      "no-store",
    );

    sendJson(
      response,
      201,
      review,
    );
  } catch (error) {
    /*
     * Drain unread request data so the connection can
     * close cleanly after an early authentication error.
     */
    request.resume();

    sendErrorResponse(
      response,
      error,
    );
  }
}

export function createRequestHandler(
  release: ReleaseMetadata,
  failureSimulator: FailureSimulator =
    createFailureSimulator(0),
  options: RequestHandlerOptions = {},
): (
  request: IncomingMessage,
  response: ServerResponse,
) => void {
  const reviewController =
    options.reviewController
    ?? new DefaultReviewController();

  const authenticateReviewRequest =
    options.authenticateReviewRequest
    ?? rejectUnavailableReviewRequest;

  return (
    request: IncomingMessage,
    response: ServerResponse,
  ): void => {
    const pathname = new URL(
      request.url ?? "/",
      "http://localhost",
    ).pathname;

    if (
      request.method === "GET"
      && pathname === "/health"
    ) {
      sendJson(response, 200, {
        service: serviceName,
        status: "ok",
      });

      return;
    }

    if (
      request.method === "GET"
      && pathname === "/version"
    ) {
      sendJson(response, 200, {
        service: serviceName,
        release,
      });

      return;
    }

    if (
      request.method === "GET"
      && pathname === "/work"
    ) {
      if (failureSimulator.shouldFail()) {
        sendJson(response, 503, {
          service: serviceName,
          release,
          error:
            "Simulated workload failure",
        });

        return;
      }

      sendJson(response, 200, {
        service: serviceName,
        release,
        result: "ok",
      });

      return;
    }

    if (pathname === "/reviews") {
      if (request.method !== "POST") {
        request.resume();

        response.setHeader(
          "allow",
          "POST",
        );

        sendErrorResponse(
          response,
          new HttpError({
            statusCode: 405,
            code: "METHOD_NOT_ALLOWED",
            message:
              "Only POST is supported for /reviews.",
          }),
        );

        return;
      }

      void handleReviewRequest(
        request,
        response,
        reviewController,
        authenticateReviewRequest,
      );

      return;
    }

    request.resume();

    sendJson(response, 404, {
      error: "Not Found",
    });
  };
}
