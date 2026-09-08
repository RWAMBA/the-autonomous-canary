(() => {
  "use strict";

  const form = document.querySelector("#lead-form");
  const status = document.querySelector("#form-status");
  const service = form?.elements.namedItem("service");
  const demoRisk = document.querySelector("#demo-risk");
  const demoDecision = document.querySelector("#demo-decision");
  const demoExplanation = document.querySelector("#demo-explanation");

  if (!(form instanceof HTMLFormElement)
    || !(status instanceof HTMLElement)
    || !(service instanceof HTMLSelectElement)) {
    return;
  }

  for (const selector of document.querySelectorAll("[data-select-service]")) {
    selector.addEventListener("click", () => {
      const selected = selector.getAttribute("data-select-service");
      if (selected !== null) {
        service.value = selected;
      }
    });
  }

  const demoScenarios = {
    clean: {
      risk: "LOW RISK · 20/100",
      decision: "CONTINUE",
      explanation:
        "CI and normalized evidence passed, so deterministic policy permits a standard deployment.",
    },
    "ci-failure": {
      risk: "CRITICAL RISK · 90/100",
      decision: "BLOCK",
      explanation:
        "Failed tests are authoritative evidence. Deterministic policy blocks deployment regardless of model advice.",
    },
    "critical-secret": {
      risk: "CRITICAL RISK · 100/100",
      decision: "BLOCK",
      explanation:
        "A critical normalized secret finding triggers a blocking rule without exposing the secret value.",
    },
  };

  if (demoRisk instanceof HTMLElement
    && demoDecision instanceof HTMLElement
    && demoExplanation instanceof HTMLElement) {
    for (const control of document.querySelectorAll("[data-demo-scenario]")) {
      control.addEventListener("click", () => {
        const scenario = demoScenarios[control.getAttribute("data-demo-scenario")];
        if (scenario === undefined) return;
        demoRisk.textContent = scenario.risk;
        demoDecision.textContent = scenario.decision;
        demoExplanation.textContent = scenario.explanation;
      });
    }
  }

  function setStatus(message, error = false) {
    status.textContent = message;
    status.classList.toggle("error", error);
  }

  function optionalValue(data, name) {
    const value = String(data.get(name) ?? "").trim();
    return value === "" ? undefined : value;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!form.reportValidity()) {
      setStatus("Complete the required fields before submitting.", true);
      return;
    }

    const submitButton = form.querySelector("button[type='submit']");
    const data = new FormData(form);
    const repositoryOwner = optionalValue(data, "repositoryOwner");
    const repositoryName = optionalValue(data, "repositoryName");

    if ((repositoryOwner === undefined) !== (repositoryName === undefined)) {
      setStatus("Provide both repository owner and repository name, or leave both blank.", true);
      return;
    }

    const submission = {
      contactName: String(data.get("contactName") ?? ""),
      workEmail: String(data.get("workEmail") ?? ""),
      organizationName: String(data.get("organizationName") ?? ""),
      service: String(data.get("service") ?? ""),
      ...(repositoryOwner === undefined ? {} : { repositoryOwner, repositoryName }),
      challenge: String(data.get("challenge") ?? ""),
      consent: data.get("consent") === "on",
      submissionToken: crypto.randomUUID(),
      website: String(data.get("website") ?? ""),
    };
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);

    if (submitButton instanceof HTMLButtonElement) {
      submitButton.disabled = true;
    }
    setStatus("Submitting your request…");

    try {
      const response = await fetch("/customer-leads", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify(submission),
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          response.status === 503
            ? "Customer intake is temporarily unavailable. Please try again later."
            : body?.error?.message ?? "The request could not be submitted.",
        );
      }

      form.reset();
      setStatus(`Request received. Reference ${body.leadId}.`);
    } catch (error) {
      setStatus(
        error instanceof DOMException && error.name === "AbortError"
          ? "The request timed out. Please try again."
          : error instanceof Error
            ? error.message
            : "The request could not be submitted.",
        true,
      );
    } finally {
      window.clearTimeout(timeout);
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = false;
      }
    }
  });
})();
