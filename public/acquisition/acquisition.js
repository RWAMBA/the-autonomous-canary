(() => {
  "use strict";

  const form = document.querySelector("#lead-form");
  const status = document.querySelector("#form-status");
  const service = form?.elements.namedItem("service");
  const demoRisk = document.querySelector("#demo-risk");
  const demoDecision = document.querySelector("#demo-decision");
  const demoExplanation = document.querySelector("#demo-explanation");
  const repositoryOwnerInput = form?.elements.namedItem("repositoryOwner");
  const repositoryNameInput = form?.elements.namedItem("repositoryName");
  const errorSummary = document.querySelector("#form-errors");
  let pendingSubmission;
  const repositoryFormatMessage =
    "Repository owner and name must use exact GitHub format: letters, numbers, periods, underscores, or hyphens—no spaces.";

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
        if (selector instanceof HTMLButtonElement) {
          service.focus({ preventScroll: true });
          service.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto" : "smooth",
            block: "center",
          });
        }
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
    "threshold-breach": {
      risk: "HIGH RISK · CANARY UNHEALTHY",
      decision: "ROLLBACK",
      explanation:
        "The canary exceeded its agreed health threshold, so policy requires rollback and records the deployment outcome.",
    },
  };

  if (demoRisk instanceof HTMLElement
    && demoDecision instanceof HTMLElement
    && demoExplanation instanceof HTMLElement) {
    for (const control of document.querySelectorAll("[data-demo-scenario]")) {
      control.addEventListener("click", () => {
        const scenario = demoScenarios[control.getAttribute("data-demo-scenario")];
        if (scenario === undefined) return;
        for (const button of document.querySelectorAll("[data-demo-scenario]")) {
          button.setAttribute("aria-pressed", String(button === control));
        }
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

  const fieldNames = {
    contactName: "Name",
    workEmail: "Work email",
    organizationName: "Organization",
    service: "Service",
    repositoryOwner: "Repository owner",
    repositoryName: "Repository name",
    challenge: "Release challenge",
    consent: "Consent",
  };

  function clearFieldErrors() {
    for (const field of form.querySelectorAll("[aria-invalid]")) {
      field.removeAttribute("aria-invalid");
      const errorId = `${field.id}-error`;
      const descriptions = (field.getAttribute("aria-describedby") ?? "")
        .split(" ").filter((id) => id !== "" && id !== errorId);
      if (descriptions.length > 0) {
        field.setAttribute("aria-describedby", descriptions.join(" "));
      } else {
        field.removeAttribute("aria-describedby");
      }
      document.getElementById(errorId)?.remove();
    }
    if (errorSummary instanceof HTMLElement) {
      errorSummary.replaceChildren();
      errorSummary.hidden = true;
    }
  }

  function showFieldErrors(errors) {
    const list = document.createElement("ul");
    for (const { field, message } of errors) {
      if (!field.id) field.id = `lead-${field.name}`;
      const errorId = `${field.id}-error`;
      field.setAttribute("aria-invalid", "true");
      const descriptions = field.getAttribute("aria-describedby");
      field.setAttribute("aria-describedby", [descriptions, errorId].filter(Boolean).join(" "));
      const note = document.createElement("small");
      note.id = errorId;
      note.className = "field-error";
      note.textContent = message;
      field.closest("label")?.append(note);
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = `#${field.id}`;
      link.textContent = `${fieldNames[field.name]}: ${message}`;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        field.focus();
      });
      item.append(link);
      list.append(item);
    }
    if (errorSummary instanceof HTMLElement) {
      const heading = document.createElement("p");
      heading.textContent = "Review these fields before submitting:";
      errorSummary.replaceChildren(heading, list);
      errorSummary.hidden = false;
      errorSummary.focus();
    } else {
      errors[0]?.field.focus();
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    clearFieldErrors();
    if (!form.checkValidity()) {
      const repositoryFormatInvalid =
        (repositoryOwnerInput instanceof HTMLInputElement
          && repositoryOwnerInput.validity.patternMismatch)
        || (repositoryNameInput instanceof HTMLInputElement
          && repositoryNameInput.validity.patternMismatch);

      setStatus(
        repositoryFormatInvalid
          ? repositoryFormatMessage
          : "Complete the required fields before submitting.",
        true,
      );
      const errors = [];
      for (const name of Object.keys(fieldNames)) {
        const field = form.elements.namedItem(name);
        if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement
          || field instanceof HTMLTextAreaElement) {
          if (!field.validity.valid) {
            errors.push({ field, message: field.validity.patternMismatch
              ? repositoryFormatMessage : field.validationMessage });
          }
        }
      }
      showFieldErrors(errors);
      return;
    }

    const submitButton = form.querySelector("button[type='submit']");
    const data = new FormData(form);
    const repositoryOwner = optionalValue(data, "repositoryOwner");
    const repositoryName = optionalValue(data, "repositoryName");

    if ((repositoryOwner === undefined) !== (repositoryName === undefined)) {
      setStatus("Provide both repository owner and repository name, or leave both blank.", true);
      const field = repositoryOwner === undefined ? repositoryOwnerInput : repositoryNameInput;
      if (field instanceof HTMLInputElement) {
        showFieldErrors([{ field, message: "Provide both repository owner and repository name, or leave both blank." }]);
      }
      return;
    }

    const submissionPayload = {
      contactName: String(data.get("contactName") ?? ""),
      workEmail: String(data.get("workEmail") ?? ""),
      organizationName: String(data.get("organizationName") ?? ""),
      service: String(data.get("service") ?? ""),
      ...(repositoryOwner === undefined ? {} : { repositoryOwner, repositoryName }),
      challenge: String(data.get("challenge") ?? ""),
      consent: data.get("consent") === "on",
      website: String(data.get("website") ?? ""),
    };
    const serializedPayload = JSON.stringify(submissionPayload);

    if (pendingSubmission?.serializedPayload !== serializedPayload) {
      pendingSubmission = {
        serializedPayload,
        submissionToken: crypto.randomUUID(),
      };
    }

    const submission = {
      ...submissionPayload,
      submissionToken: pendingSubmission.submissionToken,
    };
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);

    if (submitButton instanceof HTMLButtonElement) {
      submitButton.disabled = true;
      submitButton.textContent = "Submitting request…";
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
            : response.status === 429
              ? "Assessment requests are temporarily limited. Please try again later."
            : response.status === 400
              ? `Review the submitted fields. ${repositoryFormatMessage}`
              : body?.error?.message ?? "The request could not be submitted.",
        );
      }

      form.reset();
      pendingSubmission = undefined;
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
        submitButton.textContent = "Submit request";
      }
    }
  });
})();
