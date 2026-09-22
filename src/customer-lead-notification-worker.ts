import type {
  CustomerLeadNotificationOutbox,
} from "./persistence/customer-lead-store.js";
import type {
  CustomerLeadNotifier,
} from "./qualified-lead-notifier.js";

export interface CustomerLeadNotificationWorkerConfig {
  readonly pollIntervalMs: number;
  readonly leaseMs: number;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
}

export interface CustomerLeadNotificationWorkerOptions {
  readonly clock?: () => Date;
  readonly logger?: (entry: Readonly<Record<string, unknown>>) => void;
}

const defaultConfig: CustomerLeadNotificationWorkerConfig = {
  pollIntervalMs: 5_000,
  leaseMs: 30_000,
  retryBaseMs: 60_000,
  retryMaxMs: 3_600_000,
};

const backlogAlertAgeMs = 15 * 60_000;
const backlogMonitorMs = 60_000;
const backlogReminderMs = 5 * 60_000;

function defaultLogger(
  entry: Readonly<Record<string, unknown>>,
): void {
  console.error(JSON.stringify(entry));
}

export class CustomerLeadNotificationWorker {
  private readonly clock: () => Date;
  private readonly logger: (entry: Readonly<Record<string, unknown>>) => void;
  private timer: NodeJS.Timeout | undefined;
  private monitorTimer: NodeJS.Timeout | undefined;
  private monitoring: Promise<void> | undefined;
  private alertActive = false;
  private lastAlertAt = 0;
  private draining: Promise<void> | undefined;
  private stopping = false;

  constructor(
    private readonly outbox: CustomerLeadNotificationOutbox,
    private readonly notifier: CustomerLeadNotifier,
    private readonly config: CustomerLeadNotificationWorkerConfig = defaultConfig,
    options: CustomerLeadNotificationWorkerOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.logger = options.logger ?? defaultLogger;
  }

  start(): void {
    if (this.timer !== undefined) {
      return;
    }

    this.stopping = false;
    this.timer = setInterval(
      () => {
        void this.drain();
      },
      this.config.pollIntervalMs,
    );
    this.timer.unref();
    void this.drain();
    this.monitorTimer = setInterval(() => { void this.monitor(); }, backlogMonitorMs);
    this.monitorTimer.unref();
    void this.monitor();
  }

  async stop(): Promise<void> {
    this.stopping = true;

    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    if (this.monitorTimer !== undefined) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = undefined;
    }

    await this.draining;
    await this.monitoring;
  }

  async monitorOnce(): Promise<void> {
    const now = this.clock();
    const backlog = await this.outbox.notificationBacklog(
      new Date(now.getTime() - backlogAlertAgeMs).toISOString(),
    );
    const unhealthy = backlog.oldCount > 0 || backlog.repeatedFailureCount > 0;
    if (unhealthy && (!this.alertActive || now.getTime() - this.lastAlertAt >= backlogReminderMs)) {
      this.logger({
        event: "canaryguard.customer_lead_notification.backlog_alert",
        errorCode: "CUSTOMER_LEAD_NOTIFICATION_BACKLOG",
        pending: backlog.pending,
        oldCount: backlog.oldCount,
        repeatedFailureCount: backlog.repeatedFailureCount,
      });
      this.lastAlertAt = now.getTime();
    } else if (!unhealthy && this.alertActive) {
      this.logger({
        event: "canaryguard.customer_lead_notification.backlog_recovered",
        pending: backlog.pending,
      });
    }
    this.alertActive = unhealthy;
  }

  private monitor(): Promise<void> {
    if (this.monitoring !== undefined) return this.monitoring;
    this.monitoring = (async () => {
      try {
        await this.monitorOnce();
      } catch {
        this.logger({
          event: "canaryguard.customer_lead_notification.monitor_failed",
          errorCode: "CUSTOMER_LEAD_NOTIFICATION_MONITOR_FAILED",
        });
      } finally {
        this.monitoring = undefined;
      }
    })();
    return this.monitoring;
  }

  async runOnce(): Promise<boolean> {
    const claimedAt = this.clock();
    const claimed = await this.outbox.claimNotification(
      claimedAt.toISOString(),
      new Date(
        claimedAt.getTime() + this.config.leaseMs,
      ).toISOString(),
    );

    if (claimed === undefined) {
      return false;
    }

    try {
      await this.notifier.notify({
        event: claimed.event,
        leadId: claimed.leadId,
        occurredAt: claimed.occurredAt,
      });
      await this.outbox.completeNotification(
        claimed.notificationId,
        this.clock().toISOString(),
        claimed.attempts,
      );
    } catch {
      const exponent = Math.min(Math.max(claimed.attempts - 1, 0), 30);
      const retryDelay = Math.min(
        this.config.retryBaseMs * (2 ** exponent),
        this.config.retryMaxMs,
      );
      await this.outbox.retryNotification(
        claimed.notificationId,
        new Date(claimedAt.getTime() + retryDelay).toISOString(),
        claimed.attempts,
      );
      this.logger({
        event: "canaryguard.customer_lead_notification.retry_scheduled",
        notificationId: claimed.notificationId,
        attempt: claimed.attempts,
        errorCode: "CUSTOMER_LEAD_NOTIFICATION_FAILED",
      });
    }

    return true;
  }

  private drain(): Promise<void> {
    if (this.draining !== undefined) {
      return this.draining;
    }

    this.draining = (async () => {
      try {
        while (!this.stopping && await this.runOnce()) {
          // Drain every currently due notification before yielding to the poll timer.
        }
      } catch {
        this.logger({
          event: "canaryguard.customer_lead_notification.worker_failed",
          errorCode: "CUSTOMER_LEAD_NOTIFICATION_WORKER_FAILED",
        });
      } finally {
        this.draining = undefined;
      }
    })();

    return this.draining;
  }
}
