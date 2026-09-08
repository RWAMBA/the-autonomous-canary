(() => {
  "use strict";

  const pageSize = 25;
  const state = {
    apiKey: "",
    owner: "",
    name: "",
    nextCursor: undefined,
    releases: [],
    selectedReleaseId: undefined,
    busy: false,
    leads: [],
  };

  const elements = {
    accessForm: document.querySelector("#access-form"),
    apiKey: document.querySelector("#api-key"),
    owner: document.querySelector("#repository-owner"),
    name: document.querySelector("#repository-name"),
    connectionStatus: document.querySelector("#connection-status"),
    dashboard: document.querySelector("#dashboard"),
    repositoryLabel: document.querySelector("#repository-label"),
    clearAccess: document.querySelector("#clear-access"),
    releaseSearch: document.querySelector("#release-search"),
    riskFilter: document.querySelector("#risk-filter"),
    releaseList: document.querySelector("#release-list"),
    releaseEmpty: document.querySelector("#release-empty"),
    loadMore: document.querySelector("#load-more"),
    paginationSummary: document.querySelector("#pagination-summary"),
    metricTotal: document.querySelector("#metric-total"),
    metricRisk: document.querySelector("#metric-risk"),
    metricBlocked: document.querySelector("#metric-blocked"),
    metricRollbacks: document.querySelector("#metric-rollbacks"),
    detail: document.querySelector("#release-detail"),
    detailSubtitle: document.querySelector("#detail-subtitle"),
    detailContent: document.querySelector("#detail-content"),
    downloadEvidence: document.querySelector("#download-evidence"),
    closeDetail: document.querySelector("#close-detail"),
    loadLeads: document.querySelector("#load-leads"),
    leadQueue: document.querySelector("#lead-queue"),
    leadList: document.querySelector("#lead-list"),
    closeLeads: document.querySelector("#close-leads"),
  };

  if (Object.values(elements).some((element) => element === null)) {
    return;
  }

  function setStatus(message, error = false) {
    elements.connectionStatus.textContent = message;
    elements.connectionStatus.classList.toggle("error", error);
  }

  function setBusy(busy) {
    state.busy = busy;
    for (const control of [
      elements.accessForm.querySelector("button"),
      elements.loadMore,
      elements.clearAccess,
      elements.downloadEvidence,
      elements.loadLeads,
    ]) {
      control.disabled = busy;
    }
  }

  function textElement(tag, text, className) {
    const element = document.createElement(tag);
    element.textContent = String(text);

    if (className !== undefined) {
      element.className = className;
    }

    return element;
  }

  function formatDate(value) {
    const date = new Date(value);

    return Number.isNaN(date.getTime())
      ? "Unknown time"
      : new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(date);
  }

  function formatNumber(value, maximumFractionDigits = 2) {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits,
    }).format(value);
  }

  function shortSha(value) {
    return typeof value === "string"
      ? value.slice(0, 12)
      : "unavailable";
  }

  function normalizedClass(value) {
    return String(value ?? "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/gu, "-");
  }

  function createPill(value) {
    return textElement(
      "span",
      value ?? "UNASSESSED",
      `pill ${normalizedClass(value)}`,
    );
  }

  async function requestReport(path, searchParameters) {
    const url = new URL(path, window.location.origin);
    url.search = searchParameters.toString();
    const controller = new AbortController();
    const timeoutHandle = window.setTimeout(() => {
      controller.abort();
    }, 15_000);

    let response;

    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${state.apiKey}`,
        },
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("The reporting request timed out.");
      }

      throw new Error("The reporting service could not be reached.");
    } finally {
      window.clearTimeout(timeoutHandle);
    }

    let body;

    try {
      body = await response.json();
    } catch {
      throw new Error("The reporting service returned an unreadable response.");
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("The service API key was rejected.");
      }

      if (response.status === 404) {
        throw new Error("The requested release was not found in this repository.");
      }

      const message = body?.error?.message;
      throw new Error(
        typeof message === "string"
          ? message
          : "The reporting service could not complete the request.",
      );
    }

    return body;
  }

  async function requestLeadTransition(leadId, nextStatus) {
    const controller = new AbortController();
    const timeoutHandle = window.setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(
        `/management/customer-leads/${encodeURIComponent(leadId)}`,
        {
          method: "PATCH",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${state.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ status: nextStatus }),
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        },
      );
      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? "An ADMIN credential is required to qualify customer requests."
            : body?.error?.message ?? "The lead status could not be updated.",
        );
      }

      return body;
    } finally {
      window.clearTimeout(timeoutHandle);
    }
  }

  function nextLeadStatuses(status) {
    switch (status) {
      case "NEW": return ["QUALIFIED", "CLOSED"];
      case "QUALIFIED": return ["PROPOSAL_SENT", "CLOSED"];
      case "PROPOSAL_SENT": return ["ENGAGED", "CLOSED"];
      case "ENGAGED": return ["CLOSED"];
      default: return [];
    }
  }

  function createLeadCard(lead) {
    const card = document.createElement("article");
    card.className = "lead-card";
    const heading = document.createElement("div");
    heading.className = "lead-heading";
    heading.append(
      textElement("h3", lead.organizationName),
      createPill(lead.status),
    );
    const actions = document.createElement("div");
    actions.className = "lead-actions";

    for (const nextStatus of nextLeadStatuses(lead.status)) {
      const button = textElement(
        "button",
        nextStatus.replaceAll("_", " "),
        `button ${nextStatus === "CLOSED" ? "quiet" : "secondary"}`,
      );
      button.type = "button";
      button.addEventListener("click", async () => {
        if (state.busy) return;
        setBusy(true);
        setStatus(`Updating ${lead.organizationName}…`);
        try {
          await requestLeadTransition(lead.leadId, nextStatus);
          await loadCustomerLeads();
        } catch (error) {
          setStatus(
            error instanceof Error
              ? error.message
              : "The lead status could not be updated.",
            true,
          );
        } finally {
          setBusy(false);
        }
      });
      actions.append(button);
    }

    card.append(
      heading,
      textElement(
        "p",
        `${lead.contactName} · ${lead.workEmail}`,
        "repository-label",
      ),
      textElement("strong", String(lead.service).replaceAll("_", " ")),
      textElement("p", lead.challenge),
      textElement(
        "small",
        lead.repositoryOwner === undefined
          ? "Repository not supplied"
          : `${lead.repositoryOwner}/${lead.repositoryName}`,
        "meta",
      ),
      actions,
    );
    return card;
  }

  function renderCustomerLeads() {
    elements.leadList.replaceChildren(
      ...state.leads.map(createLeadCard),
    );
    if (state.leads.length === 0) {
      elements.leadList.append(
        textElement(
          "p",
          "No customer requests are currently queued.",
          "empty-state",
        ),
      );
    }
  }

  async function loadCustomerLeads() {
    const report = await requestReport(
      "/management/customer-leads",
      new URLSearchParams({ limit: "100" }),
    );
    state.leads = report.leads;
    elements.leadQueue.hidden = false;
    renderCustomerLeads();
    setStatus(
      `Loaded ${state.leads.length} customer request${state.leads.length === 1 ? "" : "s"}.`,
    );
  }

  async function downloadEvidence() {
    const releaseId = state.selectedReleaseId;

    if (state.busy || state.apiKey === "" || releaseId === undefined) {
      return;
    }

    setBusy(true);
    setStatus("Preparing bounded evidence report…");
    const url = new URL(
      `/management/releases/${encodeURIComponent(releaseId)}/evidence-report`,
      window.location.origin,
    );
    url.search = repositoryParameters().toString();
    const controller = new AbortController();
    const timeoutHandle = window.setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${state.apiKey}`,
        },
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? "The service API key was rejected."
            : "The evidence report could not be exported.",
        );
      }

      const objectUrl = URL.createObjectURL(
        await response.blob(),
      );
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `canaryguard-evidence-${releaseId}.json`;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setStatus("Downloaded the bounded JSON evidence report.");
    } catch (error) {
      setStatus(
        error instanceof DOMException && error.name === "AbortError"
          ? "The evidence export timed out."
          : error instanceof Error
            ? error.message
            : "The evidence report could not be exported.",
        true,
      );
    } finally {
      window.clearTimeout(timeoutHandle);
      setBusy(false);
    }
  }

  function repositoryParameters() {
    return new URLSearchParams({
      repositoryOwner: state.owner,
      repositoryName: state.name,
    });
  }

  function renderMetrics() {
    elements.metricTotal.textContent = String(state.releases.length);
    elements.metricRisk.textContent = String(
      state.releases.filter((release) =>
        ["HIGH", "CRITICAL"].includes(release.prediction?.riskLevel),
      ).length,
    );
    elements.metricBlocked.textContent = String(
      state.releases.filter(
        (release) => release.policyDecision?.decision === "BLOCK",
      ).length,
    );
    elements.metricRollbacks.textContent = String(
      state.releases.filter(
        (release) => release.outcome?.outcome === "ROLLED_BACK",
      ).length,
    );
  }

  function releaseMatches(release) {
    const query = elements.releaseSearch.value.trim().toLowerCase();
    const selectedRisk = elements.riskFilter.value;
    const risk = release.prediction?.riskLevel ?? "UNASSESSED";
    const haystack = [
      release.releaseId,
      release.headSha,
      release.baseSha,
      release.status,
      release.pullRequest?.number,
      release.pullRequest?.title,
      release.policyDecision?.decision,
      release.outcome?.outcome,
      release.modelAssessment?.ciDiagnosisCategory,
    ].filter(Boolean).join(" ").toLowerCase();

    return (query === "" || haystack.includes(query))
      && (selectedRisk === "ALL" || risk === selectedRisk);
  }

  function createReleaseCard(release) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "release-card";
    button.setAttribute(
      "aria-label",
      `View release ${shortSha(release.headSha)}`,
    );

    const identity = document.createElement("span");
    identity.className = "release-identity";
    identity.append(
      textElement("strong", shortSha(release.headSha)),
      textElement(
        "small",
        release.pullRequest === undefined
          ? formatDate(release.createdAt)
          : `PR #${release.pullRequest.number} · ${formatDate(release.createdAt)}`,
      ),
    );

    const risk = document.createElement("span");
    risk.className = "card-stat";
    risk.append(
      createPill(release.prediction?.riskLevel ?? "UNASSESSED"),
      textElement(
        "small",
        release.prediction === undefined
          ? "No prediction"
          : `Risk ${release.prediction.riskScore}/100`,
      ),
    );

    const decision = document.createElement("span");
    decision.className = "card-stat";
    decision.append(
      createPill(release.policyDecision?.decision ?? release.status),
      textElement(
        "small",
        release.outcome?.outcome
          ?? release.policyDecision?.deploymentStrategy
          ?? "Awaiting decision",
      ),
    );

    button.append(
      identity,
      risk,
      decision,
      textElement("span", "View evidence →", "meta"),
    );
    button.addEventListener("click", () => {
      void loadReleaseDetail(release.releaseId);
    });

    return button;
  }

  function renderReleaseList() {
    const releases = state.releases.filter(releaseMatches);
    elements.releaseList.replaceChildren(
      ...releases.map(createReleaseCard),
    );
    elements.releaseEmpty.hidden = releases.length !== 0;
    elements.loadMore.hidden = state.nextCursor === undefined;
    elements.paginationSummary.textContent = state.nextCursor === undefined
      ? `${state.releases.length} release${state.releases.length === 1 ? "" : "s"} loaded · end of history`
      : `${state.releases.length} releases loaded · older evidence available`;
    renderMetrics();
  }

  async function loadReleases(append) {
    if (state.busy) {
      return;
    }

    setBusy(true);
    setStatus(append ? "Loading older release evidence…" : "Loading repository evidence…");

    try {
      const parameters = repositoryParameters();
      parameters.set("limit", String(pageSize));

      if (append && state.nextCursor !== undefined) {
        parameters.set("cursor", state.nextCursor);
      }

      const report = await requestReport("/management/releases", parameters);
      state.releases = append
        ? [...state.releases, ...report.releases]
        : report.releases;
      state.nextCursor = report.nextCursor;
      elements.dashboard.hidden = false;
      elements.repositoryLabel.textContent = `${report.repository.owner}/${report.repository.name}`;
      setStatus(`Loaded ${state.releases.length} normalized release records.`);
      renderReleaseList();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Release evidence could not be loaded.",
        true,
      );

      if (!append) {
        clearDashboardData();
      }
    } finally {
      setBusy(false);
    }
  }

  function addDefinition(list, term, value) {
    const wrapper = document.createElement("div");
    wrapper.append(
      textElement("dt", term),
      textElement("dd", value ?? "Not recorded"),
    );
    list.append(wrapper);
  }

  function createOverviewCard(release) {
    const card = document.createElement("article");
    card.className = "detail-card wide";
    card.append(textElement("h3", "Release decision"));
    const list = document.createElement("dl");
    list.className = "definition-grid";
    addDefinition(list, "Head commit", release.headSha);
    addDefinition(list, "Lifecycle status", release.status);
    addDefinition(
      list,
      "Pull request",
      release.pullRequest === undefined
        ? undefined
        : `#${release.pullRequest.number} · ${release.pullRequest.state}${release.pullRequest.draft ? " · draft" : ""}`,
    );
    addDefinition(
      list,
      "Prediction",
      release.prediction === undefined
        ? undefined
        : `${release.prediction.riskLevel} · ${release.prediction.riskScore}/100`,
    );
    addDefinition(
      list,
      "Final policy",
      release.policyDecision === undefined
        ? undefined
        : `${release.policyDecision.decision} · ${release.policyDecision.deploymentStrategy} · ${release.policyDecision.initialTrafficPercent}%`,
    );
    addDefinition(list, "Outcome", release.outcome?.outcome);
    addDefinition(
      list,
      "Policy overrides",
      release.policyDecision?.policyOverrides.length
        ? release.policyDecision.policyOverrides.join(", ")
        : "None recorded",
    );
    addDefinition(
      list,
      "Prediction accuracy",
      release.outcome?.predictionDirectionallyCorrect === undefined
        ? "Not yet measured"
        : release.outcome.predictionDirectionallyCorrect ? "Directionally correct" : "Directionally incorrect",
    );
    card.append(list);
    return card;
  }

  function createModelCard(model) {
    const card = document.createElement("article");
    card.className = "detail-card";
    card.append(textElement("h3", "Model evidence"));
    const list = document.createElement("dl");
    list.className = "definition-grid";

    if (model === undefined) {
      addDefinition(list, "Assessment", "Not recorded");
    } else {
      addDefinition(list, "Provider", model.provider);
      addDefinition(list, "Model", model.modelTarget);
      addDefinition(list, "Prompt", model.promptVersion);
      addDefinition(list, "Advisory decision", model.advisoryDecision);
      addDefinition(list, "Latency", `${formatNumber(model.latencyMs)} ms`);
      addDefinition(
        list,
        "Estimated cost",
        model.estimatedCostUsd === undefined
          ? "Not recorded"
          : `$${formatNumber(model.estimatedCostUsd, 9)}`,
      );
      addDefinition(
        list,
        "Tokens",
        `${formatNumber(model.inputTokens, 0)} in · ${formatNumber(model.outputTokens, 0)} out`,
      );
      addDefinition(list, "CI diagnosis", model.ciDiagnosisCategory);
    }

    card.append(list);
    return card;
  }

  function createBoundedCard(title, section, renderItem, className = "") {
    const card = document.createElement("article");
    card.className = `detail-card ${className}`.trim();
    card.append(textElement("h3", `${title} · ${section.items.length}`));

    if (section.items.length === 0) {
      card.append(textElement("p", "No evidence recorded.", "muted"));
    } else {
      const list = document.createElement("ul");
      list.className = "evidence-list";

      for (const item of section.items) {
        list.append(renderItem(item));
      }

      card.append(list);
    }

    if (section.truncated) {
      card.append(textElement(
        "p",
        "This bounded response was truncated. Additional records exist.",
        "truncation",
      ));
    }

    return card;
  }

  function createEvidenceItem(title, detail) {
    const item = document.createElement("li");
    item.className = "evidence-item";
    item.append(textElement("strong", title));

    if (detail !== "") {
      item.append(textElement("p", detail));
    }

    return item;
  }

  function createDeploymentItem(attempt) {
    const item = createEvidenceItem(
      `${attempt.strategy} · ${attempt.status}`,
      `${attempt.provider} · started ${formatDate(attempt.startedAt)} · ${attempt.initialTrafficPercent}% initial traffic`,
    );

    if (attempt.observations.length > 0) {
      const observations = document.createElement("ul");
      observations.className = "timeline";

      for (const observation of attempt.observations) {
        observations.append(createEvidenceItem(
          `${observation.healthStatus} at ${observation.trafficPercent}%`,
          `${formatDate(observation.observedAt)} · sample ${observation.sampleSize ?? "not recorded"} · error threshold ${observation.errorRateThresholdPassed ?? "unknown"} · latency threshold ${observation.latencyThresholdPassed ?? "unknown"}`,
        ));
      }

      item.append(observations);
    }

    if (attempt.observationsTruncated) {
      item.append(textElement(
        "p",
        "Observation history is truncated.",
        "truncation",
      ));
    }

    return item;
  }

  function renderReleaseDetail(report) {
    const release = report.release;
    elements.detailSubtitle.textContent = `${report.repository.owner}/${report.repository.name} · ${shortSha(release.headSha)}`;
    const grid = document.createElement("div");
    grid.className = "detail-grid";
    grid.append(
      createOverviewCard(release),
      createModelCard(release.modelAssessment),
      createBoundedCard(
        "CI workflow runs",
        report.workflowRuns,
        (run) => createEvidenceItem(
          `${run.workflowName} · ${run.conclusion}`,
          `Run ${run.workflowRunId}, attempt ${run.runAttempt} · ${formatDate(run.updatedAt)}`,
        ),
      ),
      createBoundedCard(
        "Deterministic findings",
        report.deterministicFindings,
        (finding) => createEvidenceItem(
          `${finding.blocking ? "Blocking" : "Advisory"} · ${finding.severity} · ${finding.code}`,
          `${finding.title} — ${finding.explanation}${finding.filePath ? ` · ${finding.filePath}` : ""}`,
        ),
        "wide",
      ),
      createBoundedCard(
        "Deployment attempts",
        report.deploymentAttempts,
        createDeploymentItem,
        "wide",
      ),
      createBoundedCard(
        "Audit timeline",
        report.auditEvents,
        (event) => createEvidenceItem(
          event.eventType,
          `${event.actorType} · ${formatDate(event.occurredAt)}`,
        ),
        "wide",
      ),
    );
    elements.detailContent.replaceChildren(grid);
    elements.detail.hidden = false;
    elements.detail.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadReleaseDetail(releaseId) {
    if (state.busy || state.apiKey === "") {
      return;
    }

    state.selectedReleaseId = releaseId;
    setBusy(true);
    setStatus("Loading bounded lifecycle evidence…");

    try {
      const report = await requestReport(
        `/management/releases/${encodeURIComponent(releaseId)}`,
        repositoryParameters(),
      );

      if (state.selectedReleaseId === releaseId) {
        renderReleaseDetail(report);
        setStatus(`Loaded evidence for ${shortSha(report.release.headSha)}.`);
      }
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Release evidence could not be loaded.",
        true,
      );
    } finally {
      setBusy(false);
    }
  }

  function closeDetail() {
    state.selectedReleaseId = undefined;
    elements.detail.hidden = true;
    elements.detailContent.replaceChildren();
  }

  function clearDashboardData() {
    state.releases = [];
    state.leads = [];
    state.nextCursor = undefined;
    elements.dashboard.hidden = true;
    elements.releaseList.replaceChildren();
    elements.leadList.replaceChildren();
    elements.leadQueue.hidden = true;
    closeDetail();
    renderMetrics();
  }

  function clearAccess() {
    state.apiKey = "";
    state.owner = "";
    state.name = "";
    elements.apiKey.value = "";
    elements.releaseSearch.value = "";
    elements.riskFilter.value = "ALL";
    clearDashboardData();
    setStatus("Access cleared. Enter repository scope and a service API key to reconnect.");
    elements.apiKey.focus();
  }

  elements.accessForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!elements.accessForm.reportValidity()) {
      return;
    }

    state.apiKey = elements.apiKey.value;
    state.owner = elements.owner.value.trim();
    state.name = elements.name.value.trim();
    elements.apiKey.value = "";
    state.nextCursor = undefined;
    closeDetail();
    void loadReleases(false);
  });

  elements.clearAccess.addEventListener("click", clearAccess);
  elements.loadMore.addEventListener("click", () => {
    void loadReleases(true);
  });
  elements.releaseSearch.addEventListener("input", renderReleaseList);
  elements.riskFilter.addEventListener("change", renderReleaseList);
  elements.closeDetail.addEventListener("click", closeDetail);
  elements.loadLeads.addEventListener("click", async () => {
    if (state.busy || state.apiKey === "") return;
    setBusy(true);
    setStatus("Loading customer requests…");
    try {
      await loadCustomerLeads();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Customer requests could not be loaded.",
        true,
      );
    } finally {
      setBusy(false);
    }
  });
  elements.closeLeads.addEventListener("click", () => {
    elements.leadQueue.hidden = true;
  });
  elements.downloadEvidence.addEventListener("click", () => {
    void downloadEvidence();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!elements.detail.hidden) closeDetail();
      if (!elements.leadQueue.hidden) elements.leadQueue.hidden = true;
    }
  });
  window.addEventListener("pagehide", () => {
    state.apiKey = "";
  });
})();
