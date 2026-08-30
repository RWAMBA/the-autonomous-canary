import {
  createServer,
} from "node:http";

import {
  createRequestHandler,
} from "./app.js";
import {
  DefaultReviewController,
} from "./controllers/review-controller.js";
import {
  DefaultGitHubReviewController,
} from "./controllers/github-review-controller.js";
import {
  createIntelligenceEngine,
} from "./engines/intelligence/intelligence-engine-factory.js";
import {
  loadIntelligenceConfig,
} from "./engines/intelligence/openai-intelligence-config.js";
import {
  loadFailureSimulator,
} from "./failure-simulator.js";
import {
  GitHubAppApiClient,
} from "./github/github-api-client.js";
import {
  loadGitHubConfig,
} from "./github/github-app-config.js";
import {
  loadGitHubAutomationConfig,
} from "./github/github-automation-config.js";
import {
  loadGitHubWebhookConfig,
} from "./github/github-webhook-config.js";
import {
  DefaultGitHubWebhookReceiver,
} from "./github/github-webhook-receiver.js";
import {
  DefaultGitHubWorkflowRunProcessor,
  InMemoryGitHubWorkflowRunQueue,
} from "./github/github-workflow-automation.js";
import {
  createReviewApiKeyAuthenticator,
  loadReviewApiKey,
} from "./middleware/require-review-api-key.js";
import {
  loadReleaseMetadata,
} from "./release.js";

const defaultPort = 3000;
const host = "0.0.0.0";

function readPort(
  value: string | undefined,
): number {
  if (value === undefined) {
    return defaultPort;
  }

  const port = Number(value);

  if (
    !Number.isInteger(port)
    || port < 1
    || port > 65_535
  ) {
    throw new Error(
      `PORT must be an integer between 1 and 65535. Received: ${value}`,
    );
  }

  return port;
}

const port =
  readPort(
    process.env.PORT,
  );

const authenticateReviewRequest =
  createReviewApiKeyAuthenticator(
    loadReviewApiKey(),
  );

const intelligenceEngine =
  createIntelligenceEngine(
    loadIntelligenceConfig(),
  );

const reviewController =
  new DefaultReviewController({
    intelligenceEngine,
  });

const githubConfig =
  loadGitHubConfig();

const githubApiClient =
  githubConfig.provider === "DISABLED"
    ? undefined
    : new GitHubAppApiClient(
        githubConfig,
      );

const githubReviewController =
  githubApiClient === undefined
    ? undefined
    : new DefaultGitHubReviewController({
        evidenceCollector:
          githubApiClient,
        reviewController,
      });

const githubWebhookConfig =
  loadGitHubWebhookConfig();

const githubAutomationConfig =
  loadGitHubAutomationConfig();

const workflowRunTaskDispatcher = (() => {
  if (
    githubAutomationConfig.provider
    === "DISABLED"
  ) {
    return undefined;
  }

  if (githubApiClient === undefined) {
    throw new Error(
      "CANARYGUARD_GITHUB_AUTOMATION_PROVIDER=CHECKS requires CANARYGUARD_GITHUB_PROVIDER=APP.",
    );
  }

  if (
    githubWebhookConfig.provider
    === "DISABLED"
  ) {
    throw new Error(
      "CANARYGUARD_GITHUB_AUTOMATION_PROVIDER=CHECKS requires CANARYGUARD_GITHUB_WEBHOOK_PROVIDER=GITHUB.",
    );
  }

  const processor =
    new DefaultGitHubWorkflowRunProcessor({
      evidenceCollector:
        githubApiClient,
      changeCollector:
        githubApiClient,
      reviewController,
      checkRunPublisher:
        githubApiClient,
    });

  return new InMemoryGitHubWorkflowRunQueue(
    githubAutomationConfig,
    {
      processor,
    },
  );
})();

const githubWebhookReceiver =
  githubWebhookConfig.provider
    === "DISABLED"
    ? undefined
    : new DefaultGitHubWebhookReceiver(
        githubWebhookConfig,
        {
          ...(
            workflowRunTaskDispatcher
              === undefined
              ? {}
              : {
                  workflowRunTaskDispatcher,
                }
          ),
        },
      );

const requestHandler =
  createRequestHandler(
    loadReleaseMetadata(),
    loadFailureSimulator(),
    {
      authenticateReviewRequest,
      reviewController,
      ...(
        githubReviewController
          === undefined
          ? {}
          : {
              githubReviewController,
            }
      ),
      ...(
        githubWebhookReceiver
          === undefined
          ? {}
          : {
              githubWebhookReceiver,
            }
      ),
    },
  );

const server =
  createServer(
    requestHandler,
  );

server.listen(
  port,
  host,
  () => {
    console.log(
      `Server listening on http://${host}:${port}`,
    );
  },
);

server.on(
  "error",
  (error) => {
    console.error(
      "Server error:",
      error,
    );

    process.exitCode = 1;
  },
);

function shutdown(
  signal: NodeJS.Signals,
): void {
  console.log(
    `${signal} received. Shutting down.`,
  );

  server.close((error) => {
    if (error !== undefined) {
      console.error(
        "Shutdown error:",
        error,
      );

      process.exitCode = 1;
      return;
    }

    console.log(
      "Server stopped.",
    );
  });
}

process.once(
  "SIGINT",
  () => shutdown("SIGINT"),
);

process.once(
  "SIGTERM",
  () => shutdown("SIGTERM"),
);
