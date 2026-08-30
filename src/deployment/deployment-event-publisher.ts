import type {
  DeploymentEventDto,
  DeploymentEventReceiptDto,
} from "../dto/deployment-event.js";
import {
  parseDeploymentEvent,
  parseDeploymentEventReceipt,
} from "../dto/deployment-event.js";
import type {
  HttpDeploymentEventPublisherConfig,
} from "./deployment-event-publisher-config.js";

export const maximumDeploymentEventResponseBytes =
  65_536;

const transientStatusCodes = new Set([
  408,
  429,
  500,
  502,
  503,
  504,
]);

class DeploymentEventResponseBoundaryError
extends Error {}

export interface DeploymentEventPublisher {
  publish(
    event: DeploymentEventDto,
  ): Promise<DeploymentEventReceiptDto>;
}

export interface HttpDeploymentEventPublisherOptions {
  readonly request?: typeof fetch;
  readonly wait?: (delayMs: number) => Promise<void>;
}

function delay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function readBoundedResponse(
  response: Response,
): Promise<string> {
  const declaredLength = Number(
    response.headers.get("content-length"),
  );

  if (
    Number.isFinite(declaredLength)
    && declaredLength
      > maximumDeploymentEventResponseBytes
  ) {
    try {
      await response.body?.cancel();
    } catch {
      // Preserve the controlled boundary error.
    }

    throw new DeploymentEventResponseBoundaryError(
      "Deployment event response exceeded the configured size limit.",
    );
  }

  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        break;
      }

      totalBytes += result.value.byteLength;

      if (
        totalBytes
          > maximumDeploymentEventResponseBytes
      ) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the controlled boundary error.
        }

        throw new DeploymentEventResponseBoundaryError(
          "Deployment event response exceeded the configured size limit.",
        );
      }

      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder(
      "utf-8",
      {
        fatal: true,
      },
    ).decode(body);
  } catch {
    throw new DeploymentEventResponseBoundaryError(
      "Deployment event response was not valid UTF-8.",
    );
  }
}

function expectedDeploymentAttemptId(
  event: DeploymentEventDto,
): string | undefined {
  return "deploymentAttemptId" in event
    ? event.deploymentAttemptId
    : undefined;
}

function verifyReceipt(
  event: DeploymentEventDto,
  responseStatus: number,
  input: unknown,
): DeploymentEventReceiptDto {
  let receipt: DeploymentEventReceiptDto;

  try {
    receipt =
      parseDeploymentEventReceipt(input);
  } catch {
    throw new Error(
      "Deployment event response failed validation.",
    );
  }

  if (
    receipt.eventId !== event.eventId
    || receipt.eventType !== event.eventType
    || receipt.releaseId !== event.releaseId
    || receipt.deploymentAttemptId
      !== expectedDeploymentAttemptId(event)
  ) {
    throw new Error(
      "Deployment event response did not match the submitted event identity.",
    );
  }

  if (
    (responseStatus === 200 && !receipt.replayed)
    || (responseStatus === 202 && receipt.replayed)
  ) {
    throw new Error(
      "Deployment event response status did not match its replay state.",
    );
  }

  return receipt;
}

export class HttpDeploymentEventPublisher
implements DeploymentEventPublisher {
  private readonly config:
    HttpDeploymentEventPublisherConfig;
  private readonly request: typeof fetch;
  private readonly wait:
    (delayMs: number) => Promise<void>;

  constructor(
    config: HttpDeploymentEventPublisherConfig,
    options:
      HttpDeploymentEventPublisherOptions = {},
  ) {
    this.config = config;
    this.request = options.request ?? fetch;
    this.wait = options.wait ?? delay;
  }

  async publish(
    input: DeploymentEventDto,
  ): Promise<DeploymentEventReceiptDto> {
    const event = parseDeploymentEvent(input);
    const requestBody = JSON.stringify(event);

    for (
      let attempt = 0;
      attempt <= this.config.maxRetries;
      attempt += 1
    ) {
      const abortController =
        new AbortController();
      const timeout = setTimeout(
        () => abortController.abort(),
        this.config.timeoutMs,
      );

      let response: Response;
      let responseBody: string;

      try {
        response = await this.request(
          this.config.endpoint,
          {
            method: "POST",
            redirect: "error",
            signal: abortController.signal,
            headers: {
              accept: "application/json",
              authorization:
                `Bearer ${this.config.apiKey}`,
              "cache-control": "no-store",
              "content-type": "application/json",
            },
            body: requestBody,
          },
        );

        responseBody =
          await readBoundedResponse(response);
      } catch (error) {
        if (
          error instanceof
            DeploymentEventResponseBoundaryError
        ) {
          throw error;
        }

        if (attempt < this.config.maxRetries) {
          await this.wait(
            100 * (2 ** attempt),
          );
          continue;
        }

        throw new Error(
          "Deployment event request failed after bounded retries.",
        );
      } finally {
        clearTimeout(timeout);
      }

      if (
        transientStatusCodes.has(response.status)
        && attempt < this.config.maxRetries
      ) {
        await this.wait(
          100 * (2 ** attempt),
        );
        continue;
      }

      if (
        response.status !== 200
        && response.status !== 202
      ) {
        throw new Error(
          `Deployment event request returned HTTP ${response.status}.`,
        );
      }

      let responsePayload: unknown;

      try {
        responsePayload = JSON.parse(
          responseBody,
        );
      } catch {
        throw new Error(
          "Deployment event response was not valid JSON.",
        );
      }

      return verifyReceipt(
        event,
        response.status,
        responsePayload,
      );
    }

    throw new Error(
      "Deployment event request exhausted its bounded attempts.",
    );
  }
}
