export const intelligenceProviderEnvironmentVariable =
  "CANARYGUARD_INTELLIGENCE_PROVIDER";

export const openAIApiKeyEnvironmentVariable =
  "OPENAI_API_KEY";

export const openAITimeoutEnvironmentVariable =
  "OPENAI_TIMEOUT_MS";

export const openAIMaxRetriesEnvironmentVariable =
  "OPENAI_MAX_RETRIES";

export const openAIMaxOutputTokensEnvironmentVariable =
  "OPENAI_MAX_OUTPUT_TOKENS";

export const openAIIntelligenceModelTarget =
  "gpt-5.6-luna";

export const defaultOpenAITimeoutMs =
  15_000;

export const minimumOpenAITimeoutMs =
  1_000;

export const maximumOpenAITimeoutMs =
  60_000;

export const defaultOpenAIMaxRetries = 2;
export const maximumOpenAIMaxRetries = 3;

export const defaultOpenAIMaxOutputTokens =
  4_000;

export const minimumOpenAIMaxOutputTokens =
  256;

export const maximumOpenAIMaxOutputTokens =
  16_000;

export const maximumOpenAIApiKeyBytes =
  512;

export interface MockIntelligenceConfig {
  readonly provider: "MOCK";
}

export interface OpenAIIntelligenceConfig {
  readonly provider: "OPENAI";
  readonly apiKey: string;
  readonly model:
    typeof openAIIntelligenceModelTarget;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly maxOutputTokens: number;
}

export type IntelligenceConfig =
  | MockIntelligenceConfig
  | OpenAIIntelligenceConfig;

function readBoundedInteger(
  environment: NodeJS.ProcessEnv,
  variableName: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const value =
    environment[variableName];

  if (value === undefined) {
    return defaultValue;
  }

  if (!/^[0-9]+$/u.test(value)) {
    throw new Error(
      `${variableName} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  const parsedValue = Number(value);

  if (
    !Number.isSafeInteger(parsedValue)
    || parsedValue < minimum
    || parsedValue > maximum
  ) {
    throw new Error(
      `${variableName} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  return parsedValue;
}

function loadOpenAIApiKey(
  environment: NodeJS.ProcessEnv,
): string {
  const apiKey =
    environment[
      openAIApiKeyEnvironmentVariable
    ];

  if (apiKey === undefined) {
    throw new Error(
      `${openAIApiKeyEnvironmentVariable} must be configured when ${intelligenceProviderEnvironmentVariable}=OPENAI.`,
    );
  }

  if (
    apiKey.length === 0
    || apiKey.trim() !== apiKey
    || /[\s,]/u.test(apiKey)
  ) {
    throw new Error(
      `${openAIApiKeyEnvironmentVariable} must be a single non-whitespace token.`,
    );
  }

  const byteLength =
    Buffer.byteLength(
      apiKey,
      "utf8",
    );

  if (
    byteLength
    > maximumOpenAIApiKeyBytes
  ) {
    throw new Error(
      `${openAIApiKeyEnvironmentVariable} must not exceed ${maximumOpenAIApiKeyBytes} bytes.`,
    );
  }

  return apiKey;
}

export function loadIntelligenceConfig(
  environment:
    NodeJS.ProcessEnv = process.env,
): IntelligenceConfig {
  const provider =
    environment[
      intelligenceProviderEnvironmentVariable
    ]
    ?? "MOCK";

  if (provider === "MOCK") {
    return Object.freeze({
      provider: "MOCK",
    });
  }

  if (provider !== "OPENAI") {
    throw new Error(
      `${intelligenceProviderEnvironmentVariable} must be MOCK or OPENAI.`,
    );
  }

  const apiKey =
    loadOpenAIApiKey(environment);

  const timeoutMs =
    readBoundedInteger(
      environment,
      openAITimeoutEnvironmentVariable,
      defaultOpenAITimeoutMs,
      minimumOpenAITimeoutMs,
      maximumOpenAITimeoutMs,
    );

  const maxRetries =
    readBoundedInteger(
      environment,
      openAIMaxRetriesEnvironmentVariable,
      defaultOpenAIMaxRetries,
      0,
      maximumOpenAIMaxRetries,
    );

  const maxOutputTokens =
    readBoundedInteger(
      environment,
      openAIMaxOutputTokensEnvironmentVariable,
      defaultOpenAIMaxOutputTokens,
      minimumOpenAIMaxOutputTokens,
      maximumOpenAIMaxOutputTokens,
    );

  return Object.freeze({
    provider: "OPENAI",
    apiKey,
    model:
      openAIIntelligenceModelTarget,
    timeoutMs,
    maxRetries,
    maxOutputTokens,
  });
}
