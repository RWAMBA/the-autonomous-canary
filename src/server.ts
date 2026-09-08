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
  DefaultDeploymentEventController,
} from "./controllers/deployment-event-controller.js";
import {
  DefaultManagementReportController,
} from "./controllers/management-report-controller.js";
import {
  DefaultCustomerLeadController,
} from "./controllers/customer-lead-controller.js";
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
  DurableGitHubWorkflowRunWorker,
  InMemoryGitHubWorkflowRunQueue,
} from "./github/github-workflow-automation.js";
import {
  createReviewApiKeyAuthenticator,
  loadReviewApiKey,
} from "./middleware/require-review-api-key.js";
import {
  loadReleaseMetadata,
} from "./release.js";
import {
  loadDurableAutomationConfig,
} from "./persistence/durable-automation-config.js";
import {
  createPostgresPool,
  PostgresReleaseLifecycleStore,
} from "./persistence/postgres-release-lifecycle-store.js";
import {
  PostgresManagementReportStore,
} from "./persistence/postgres-management-report-store.js";
import {
  PostgresCustomerLeadStore,
} from "./persistence/postgres-customer-lead-store.js";
import {
  HttpQualifiedLeadNotifier,
} from "./qualified-lead-notifier.js";
import {
  loadPersistenceConfig,
} from "./persistence/persistence-config.js";
import {
  loadTenantAuthorizationConfig,
} from "./authorization/tenant-authorization-config.js";
import {
  PostgresTenantAuthorization,
} from "./authorization/postgres-tenant-authorization.js";
import {
  allowLegacyTenantResources,
} from "./authorization/tenant-authorization.js";
import {
  loadCustomerAcquisitionConfig,
} from "./customer-acquisition-config.js";

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

const intelligenceEngine =
  createIntelligenceEngine(
    loadIntelligenceConfig(),
  );

const persistenceConfig =
  loadPersistenceConfig();

const postgresPool = (() => {
  if (
    persistenceConfig.provider
    === "DISABLED"
  ) {
    return undefined;
  }

  return createPostgresPool(
    persistenceConfig,
  );
})();

const lifecycleStore =
  postgresPool === undefined
    ? undefined
    : new PostgresReleaseLifecycleStore(
        postgresPool,
      );

await lifecycleStore?.verifySchema();

const tenantAuthorizationConfig =
  loadTenantAuthorizationConfig();

const tenantAuthorization = (() => {
  if (
    tenantAuthorizationConfig.provider
    === "LEGACY"
  ) {
    return undefined;
  }

  if (postgresPool === undefined) {
    throw new Error(
      "CANARYGUARD_AUTHORIZATION_PROVIDER=POSTGRES requires CANARYGUARD_PERSISTENCE_PROVIDER=POSTGRES.",
    );
  }

  return new PostgresTenantAuthorization(
    postgresPool,
  );
})();

const authenticateReviewRequest =
  tenantAuthorization === undefined
    ? createReviewApiKeyAuthenticator(
        loadReviewApiKey(),
      )
    : tenantAuthorization.authenticateRequest
        .bind(tenantAuthorization);

const resourceAuthorizer =
  tenantAuthorization
  ?? allowLegacyTenantResources;

const reviewController =
  new DefaultReviewController({
    intelligenceEngine,
    resourceAuthorizer,
    ...(
      lifecycleStore === undefined
        ? {}
        : {
            lifecycleRecorder:
              lifecycleStore,
          }
    ),
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
      externalEvidenceCollector:
        githubApiClient,
      reviewController,
      resourceAuthorizer,
      });

const githubWebhookConfig =
  loadGitHubWebhookConfig();

const githubAutomationConfig =
  loadGitHubAutomationConfig();

if (
  lifecycleStore !== undefined
  && githubWebhookConfig.provider
    === "GITHUB"
  && githubAutomationConfig.provider
    === "DISABLED"
) {
  throw new Error(
    "PostgreSQL-backed GitHub webhook ingestion requires CANARYGUARD_GITHUB_AUTOMATION_PROVIDER=CHECKS.",
  );
}

let durableWorkflowRunWorker:
  DurableGitHubWorkflowRunWorker
  | undefined;

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
      externalEvidenceCollector:
        githubApiClient,
      changeCollector:
        githubApiClient,
      reviewController,
      checkRunPublisher:
        githubApiClient,
    });

  if (lifecycleStore !== undefined) {
    durableWorkflowRunWorker =
      new DurableGitHubWorkflowRunWorker(
        {
          concurrency:
            githubAutomationConfig
              .concurrency,
          ...loadDurableAutomationConfig(),
        },
        {
          store: lifecycleStore,
          processor,
        },
      );

    return undefined;
  }

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
          ...(
            lifecycleStore === undefined
              ? {}
              : {
                  lifecycleStore,
                }
          ),
        },
      );

const deploymentEventController =
  lifecycleStore === undefined
    ? undefined
    : new DefaultDeploymentEventController(
        lifecycleStore,
        resourceAuthorizer,
      );

const managementReportController =
  postgresPool === undefined
    ? undefined
    : new DefaultManagementReportController(
      new PostgresManagementReportStore(
        postgresPool,
      ),
      {
        resourceAuthorizer,
      },
      );

const customerAcquisitionConfig =
  loadCustomerAcquisitionConfig();

const customerLeadController = (() => {
  if (customerAcquisitionConfig.provider === "DISABLED") {
    return undefined;
  }

  if (postgresPool === undefined) {
    throw new Error(
      "CANARYGUARD_CUSTOMER_ACQUISITION_PROVIDER=POSTGRES requires CANARYGUARD_PERSISTENCE_PROVIDER=POSTGRES.",
    );
  }

  if (tenantAuthorizationConfig.provider !== "POSTGRES") {
    throw new Error(
      "CANARYGUARD_CUSTOMER_ACQUISITION_PROVIDER=POSTGRES requires CANARYGUARD_AUTHORIZATION_PROVIDER=POSTGRES.",
    );
  }

  return new DefaultCustomerLeadController(
    new PostgresCustomerLeadStore(postgresPool),
    {
      adminTenantId:
        customerAcquisitionConfig.adminTenantId,
      qualifiedLeadNotifier:
        new HttpQualifiedLeadNotifier(
          customerAcquisitionConfig.qualifiedLeadNotification,
        ),
    },
  );
})();

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
      ...(
        deploymentEventController
          === undefined
          ? {}
          : {
              deploymentEventController,
            }
      ),
      ...(
        managementReportController
          === undefined
          ? {}
          : {
              managementReportController,
            }
      ),
      ...(
        customerLeadController === undefined
          ? {}
          : { customerLeadController }
      ),
    },
  );

const server =
  createServer(
    requestHandler,
  );

if (
  githubConfig.provider === "APP"
  && (
    githubConfig.axeEvidenceProvider === "AXE"
    || githubConfig.phase7EvidenceProvider === "ENABLED"
  )
) {
  durableWorkflowRunWorker?.start();
}

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

async function shutdown(
  signal: NodeJS.Signals,
): Promise<void> {
  console.log(
    `${signal} received. Shutting down.`,
  );

  await new Promise<void>((resolve) => {
    server.close((error) => {
      if (error !== undefined) {
        console.error(
          "Shutdown error:",
          error,
        );

        process.exitCode = 1;
      }

      resolve();
    });
  });

  await durableWorkflowRunWorker?.stop();
  await lifecycleStore?.close();

  console.log(
    "Server stopped.",
  );
}

process.once(
  "SIGINT",
  () => {
    void shutdown("SIGINT");
  },
);

process.once(
  "SIGTERM",
  () => {
    void shutdown("SIGTERM");
  },
);
