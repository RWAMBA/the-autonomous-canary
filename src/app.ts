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
import type {
  GitHubReviewController,
} from "./controllers/github-review-controller.js";
import type {
  GitHubWebhookReceiver,
} from "./github/github-webhook-receiver.js";
import type {
  DeploymentEventController,
} from "./controllers/deployment-event-controller.js";
import type {
  ReviewResponseDto,
} from "./dto/review-response.js";
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
import {
  readRawBody,
} from "./middleware/read-raw-body.js";
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
  readonly githubReviewController?:
    GitHubReviewController;
  readonly githubWebhookReceiver?:
    GitHubWebhookReceiver;
  readonly deploymentEventController?:
    DeploymentEventController;
  readonly authenticateReviewRequest?:
    ReviewApiKeyAuthenticator;
}

interface ReviewCreator {
  createReview(
    input: unknown,
  ): Promise<ReviewResponseDto>;
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
  reviewController:
    ReviewCreator | undefined,
  authenticateReviewRequest:
    ReviewApiKeyAuthenticator,
  unavailableCode:
    "REVIEW_API_UNAVAILABLE"
    | "GITHUB_APP_UNAVAILABLE",
): Promise<void> {
  try {
    /*
     * Authentication happens before the body is read.
     * Unauthorized callers cannot consume validation,
     * sanitization, policy, or intelligence resources.
     */
    authenticateReviewRequest(request);

    if (reviewController === undefined) {
      throw new HttpError({
        statusCode: 503,
        code: unavailableCode,
        message:
          "The requested review provider is not configured.",
        expose: false,
      });
    }

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

async function handleGitHubWebhookRequest(
  request: IncomingMessage,
  response: ServerResponse,
  receiver:
    GitHubWebhookReceiver | undefined,
): Promise<void> {
  try {
    if (receiver === undefined) {
      throw new HttpError({
        statusCode: 503,
        code:
          "GITHUB_WEBHOOK_UNAVAILABLE",
        message:
          "GitHub webhook ingestion is not configured.",
        expose: false,
      });
    }

    const rawBody =
      await readRawBody(request);

    const receipt = await receiver.receive({
      headers: request.headers,
      rawBody,
    });

    response.setHeader(
      "cache-control",
      "no-store",
    );

    sendJson(
      response,
      202,
      receipt,
    );
  } catch (error) {
    request.resume();

    sendErrorResponse(
      response,
      error,
    );
  }
}

async function handleDeploymentEventRequest(
  request: IncomingMessage,
  response: ServerResponse,
  controller:
    DeploymentEventController | undefined,
  authenticateReviewRequest:
    ReviewApiKeyAuthenticator,
): Promise<void> {
  try {
    authenticateReviewRequest(request);

    if (controller === undefined) {
      throw new HttpError({
        statusCode: 503,
        code:
          "DEPLOYMENT_EVENT_API_UNAVAILABLE",
        message:
          "Deployment event ingestion is not configured.",
        expose: false,
      });
    }

    const input = await readJsonBody(request);
    const receipt =
      await controller.recordEvent(input);

    response.setHeader(
      "cache-control",
      "no-store",
    );

    sendJson(
      response,
      receipt.replayed ? 200 : 202,
      receipt,
    );
  } catch (error) {
    request.resume();
    sendErrorResponse(response, error);
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

  const githubReviewController =
    options.githubReviewController;

  const githubWebhookReceiver =
    options.githubWebhookReceiver;

  const deploymentEventController =
    options.deploymentEventController;

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
        "REVIEW_API_UNAVAILABLE",
      );

      return;
    }

    if (pathname === "/github/reviews") {
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
              "Only POST is supported for /github/reviews.",
          }),
        );

        return;
      }

      void handleReviewRequest(
        request,
        response,
        githubReviewController,
        authenticateReviewRequest,
        "GITHUB_APP_UNAVAILABLE",
      );

      return;
    }

    if (pathname === "/github/webhooks") {
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
              "Only POST is supported for /github/webhooks.",
          }),
        );

        return;
      }

      void handleGitHubWebhookRequest(
        request,
        response,
        githubWebhookReceiver,
      );

      return;
    }

    if (pathname === "/deployment-events") {
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
              "Only POST is supported for /deployment-events.",
          }),
        );

        return;
      }

      void handleDeploymentEventRequest(
        request,
        response,
        deploymentEventController,
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
