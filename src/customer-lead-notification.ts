export type CustomerLeadNotificationEvent =
  | "RECEIVED"
  | "QUALIFIED";

export interface CustomerLeadNotification {
  readonly event: CustomerLeadNotificationEvent;
  readonly leadId: string;
  readonly occurredAt: string;
}

export function createCustomerLeadNotificationId(
  event: CustomerLeadNotificationEvent,
  leadId: string,
): string {
  return event === "RECEIVED"
    ? `customer-lead:received:${leadId}`
    : `qualified-lead:${leadId}`;
}
