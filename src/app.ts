import type {
  IncomingMessage,
  ServerResponse,
} from "node:http";

import {
  createFailureSimulator,
  loadFailureSimulator,
  type FailureSimulator,
} from "./failure-simulator.js";
import {
  loadReleaseMetadata,
  type ReleaseMetadata,
} from "./release.js";

const serviceName = "the-autonomous-canary";

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

export function createRequestHandler(
  release: ReleaseMetadata,
  failureSimulator: FailureSimulator =
    createFailureSimulator(0),
): (
  request: IncomingMessage,
  response: ServerResponse,
) => void {
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
          error: "Simulated workload failure",
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

    sendJson(response, 404, {
      error: "Not Found",
    });
  };
}

export const requestHandler = createRequestHandler(
  loadReleaseMetadata(),
  loadFailureSimulator(),
);
