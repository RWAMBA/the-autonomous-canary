export interface QualifiedLeadNotification {
  readonly leadId: string;
  readonly occurredAt: string;
}

export interface QualifiedLeadNotifier {
  notify(notification: QualifiedLeadNotification): Promise<void>;
}

export interface HttpQualifiedLeadNotifierConfig {
  readonly url: URL;
  readonly apiKey: string;
  readonly recipient: string;
}

export interface HttpQualifiedLeadNotifierOptions {
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
}

export class HttpQualifiedLeadNotifier
implements QualifiedLeadNotifier {
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: HttpQualifiedLeadNotifierConfig,
    options: HttpQualifiedLeadNotifierOptions = {},
  ) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async notify(notification: QualifiedLeadNotification): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImplementation(this.config.url, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": `qualified-lead:${notification.leadId}`,
        },
        body: JSON.stringify({
          recipient: this.config.recipient,
          subject: "CanaryGuard customer request qualified",
          text:
            `Customer request ${notification.leadId} was qualified at ${notification.occurredAt}. Open the protected CanaryGuard management dashboard to continue.`,
        }),
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error("Qualified-lead notification relay rejected the request.");
      }
    } catch (error) {
      if (error instanceof Error
        && error.message === "Qualified-lead notification relay rejected the request.") {
        throw error;
      }

      throw new Error("Qualified-lead notification could not be delivered.");
    } finally {
      clearTimeout(timeout);
    }
  }
}
