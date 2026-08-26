export interface FailureSimulator {
  shouldFail(): boolean;
}

function validateFailureInterval(
  failureInterval: number,
): void {
  if (
    !Number.isInteger(failureInterval)
    || failureInterval < 0
  ) {
    throw new Error(
      "Failure interval must be a non-negative integer.",
    );
  }
}

export function createFailureSimulator(
  failureInterval: number,
): FailureSimulator {
  validateFailureInterval(failureInterval);

  let requestsUntilFailure = failureInterval;

  return Object.freeze({
    shouldFail(): boolean {
      if (failureInterval === 0) {
        return false;
      }

      requestsUntilFailure -= 1;

      if (requestsUntilFailure > 0) {
        return false;
      }

      requestsUntilFailure = failureInterval;
      return true;
    },
  });
}

export function loadFailureSimulator(
  environment: NodeJS.ProcessEnv = process.env,
): FailureSimulator {
  const configuredValue =
    environment.SIMULATED_FAILURE_EVERY?.trim();

  if (
    configuredValue === undefined
    || configuredValue.length === 0
  ) {
    return createFailureSimulator(0);
  }

  const failureInterval = Number(configuredValue);

  if (
    !Number.isInteger(failureInterval)
    || failureInterval < 0
  ) {
    throw new Error(
      "SIMULATED_FAILURE_EVERY must be a non-negative integer.",
    );
  }

  return createFailureSimulator(failureInterval);
}
