import type { IncomingMessage, ServerResponse } from "node:http";

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

    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, {
        service: serviceName,
        status: "ok",
      });
      return;
    }

    if (request.method === "GET" && pathname === "/version") {
      sendJson(response, 200, {
        service: serviceName,
        release,
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
);
