import type { CustomerRepository } from "../ports.js";

export interface InquiryEvent {
  readonly customerId: string;
  readonly status: "pending" | "needs_review" | "approved" | "declined";
  readonly occurredAt: Date;
}

export interface ApplyInquiryStatusDeps {
  readonly customers: CustomerRepository;
}

/**
 * Advances a customer's KYC state from a Persona inquiry outcome and sets the
 * trading gate. Only an `approved` inquiry unblocks trading; every other state
 * (pending, needs_review, declined) keeps funding and trading closed.
 */
export async function applyInquiryStatus(
  deps: ApplyInquiryStatusDeps,
  event: InquiryEvent,
): Promise<void> {
  const customer = await deps.customers.findById(event.customerId);
  if (!customer) throw new Error(`unknown customer: ${event.customerId}`);
  const tradingBlocked = event.status !== "approved";
  await deps.customers.setKycStatus(event.customerId, event.status, tradingBlocked);
}
