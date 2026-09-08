import {
  discoverRenderDeploymentCorrelation,
  ManagementApiReleaseDiscovery,
  RenderApiDeploymentDiscovery,
} from "../src/deployment/render-deployment-discovery.js";
import {
  loadRenderDeploymentDiscoveryConfig,
} from "../src/deployment/render-deployment-discovery-config.js";
import {
  GitHubAppApiClient,
} from "../src/github/github-api-client.js";
import {
  loadGitHubConfig,
} from "../src/github/github-app-config.js";

const githubConfig = loadGitHubConfig();

if (githubConfig.provider !== "APP") {
  throw new Error(
    "Render deployment discovery requires CANARYGUARD_GITHUB_PROVIDER=APP.",
  );
}

const correlation =
  await discoverRenderDeploymentCorrelation(
    loadRenderDeploymentDiscoveryConfig(),
    {
      render: new RenderApiDeploymentDiscovery(),
      github: new GitHubAppApiClient(
        githubConfig,
      ),
      releases:
        new ManagementApiReleaseDiscovery(),
    },
  );

console.log(JSON.stringify(correlation, null, 2));
