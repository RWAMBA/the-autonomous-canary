export type GitHubWebhookClock =
  () => number;

export type GitHubDeliveryReservation =
  | "ACCEPTED"
  | "DUPLICATE"
  | "CAPACITY_EXCEEDED";

export interface GitHubWebhookReplayGuard {
  reserve(
    deliveryId: string,
  ): GitHubDeliveryReservation;
}

export interface InMemoryGitHubWebhookReplayGuardOptions {
  readonly ttlMs: number;
  readonly capacity: number;
  readonly clock?: GitHubWebhookClock;
}

export class InMemoryGitHubWebhookReplayGuard
implements GitHubWebhookReplayGuard {
  private readonly ttlMs: number;

  private readonly capacity: number;

  private readonly clock:
    GitHubWebhookClock;

  private readonly deliveries =
    new Map<string, number>();

  constructor(
    options:
      InMemoryGitHubWebhookReplayGuardOptions,
  ) {
    if (
      !Number.isSafeInteger(options.ttlMs)
      || options.ttlMs < 1
    ) {
      throw new RangeError(
        "ttlMs must be a positive safe integer.",
      );
    }

    if (
      !Number.isSafeInteger(options.capacity)
      || options.capacity < 1
    ) {
      throw new RangeError(
        "capacity must be a positive safe integer.",
      );
    }

    this.ttlMs = options.ttlMs;
    this.capacity = options.capacity;
    this.clock = options.clock
      ?? Date.now;
  }

  private readCurrentTime(): number {
    const currentTime = this.clock();

    if (
      !Number.isSafeInteger(currentTime)
      || currentTime < 0
      || currentTime
        > Number.MAX_SAFE_INTEGER
          - this.ttlMs
    ) {
      throw new Error(
        "GitHub webhook replay clock returned an invalid time.",
      );
    }

    return currentTime;
  }

  private removeExpired(
    currentTime: number,
  ): void {
    for (const [
      deliveryId,
      expiresAt,
    ] of this.deliveries) {
      if (expiresAt > currentTime) {
        continue;
      }

      this.deliveries.delete(
        deliveryId,
      );
    }
  }

  reserve(
    deliveryId: string,
  ): GitHubDeliveryReservation {
    const currentTime =
      this.readCurrentTime();

    this.removeExpired(currentTime);

    if (this.deliveries.has(deliveryId)) {
      return "DUPLICATE";
    }

    if (
      this.deliveries.size
      >= this.capacity
    ) {
      return "CAPACITY_EXCEEDED";
    }

    this.deliveries.set(
      deliveryId,
      currentTime + this.ttlMs,
    );

    return "ACCEPTED";
  }
}
