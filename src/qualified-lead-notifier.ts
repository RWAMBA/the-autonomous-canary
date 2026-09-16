export interface CustomerLeadNotification {
  readonly event: "RECEIVED" | "QUALIFIED";
  readonly leadId: string;
  readonly occurredAt: string;
}

export interface CustomerLeadNotifier {
  notify(notification: CustomerLeadNotification): Promise<void>;
}

export interface HttpCustomerLeadNotifierConfig {
  readonly url: URL;
  readonly apiKey: string;
  readonly recipient: string;
}

export interface HttpCustomerLeadNotifierOptions {
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
}

export class HttpCustomerLeadNotifier
implements CustomerLeadNotifier {
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: HttpCustomerLeadNotifierConfig,
    options: HttpCustomerLeadNotifierOptions = {},
  ) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async notify(notification: CustomerLeadNotification): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImplementation(this.config.url, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
          "idempotency-key":
            `customer-lead:${notification.event.toLowerCase()}:${notification.leadId}`,
        },
        body: JSON.stringify({
          recipient: this.config.recipient,
          ...notificationContent(notification),
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

function notificationContent(
  notification: CustomerLeadNotification,
): { readonly subject: string; readonly text: string } {
  if (notification.event === "RECEIVED") {
    return {
      subject: "New CanaryGuard customer request",
      text:
        `Customer request ${notification.leadId} was received at ${notification.occurredAt}. Open the protected CanaryGuard management dashboard to review it.`,
    };
  }

  return {
    subject: "CanaryGuard customer request qualified",
    text:
      `Customer request ${notification.leadId} was qualified at ${notification.occurredAt}. Open the protected CanaryGuard management dashboard to continue.`,
  };
}
