import { isBrokerOutage } from "../errors.js";
import type { BrokerPort, CustomerRepository, OrderRepository } from "../ports.js";

export interface SubmitQueuedOrdersDeps {
  readonly orders: OrderRepository;
  readonly customers: CustomerRepository;
  readonly broker: BrokerPort;
}

export interface SubmitQueuedOrdersResult {
  readonly attempted: number;
  readonly submitted: number;
  /** Still queued because the broker is still down (5xx / no answer). */
  readonly stillQueued: number;
  /** The broker answered with a rejection (4xx); these need a human, not a retry. */
  readonly rejected: readonly { orderId: string; reason: string }[];
}

/**
 * Re-sends orders that `placeOrder` queued while the broker was unreachable
 * (ADR-0007). Idempotent at the broker through `client_order_id`: if the first
 * attempt actually landed, Alpaca answers the retry with the same order id and
 * we only record it. Runs from the worker every `ORDER_RETRY_MS`.
 */
export async function submitQueuedOrders(
  deps: SubmitQueuedOrdersDeps,
  limit = 50,
): Promise<SubmitQueuedOrdersResult> {
  const queued = await deps.orders.listAwaitingSubmission(limit);
  let submitted = 0;
  let stillQueued = 0;
  const rejected: { orderId: string; reason: string }[] = [];

  for (const order of queued) {
    const customer = await deps.customers.findById(order.customerId);
    if (!customer?.brokerAccountId) {
      rejected.push({ orderId: order.id, reason: "customer has no broker account" });
      continue;
    }
    const notionalCents = order.requestedNotionalCents ?? null;
    if (notionalCents === null || notionalCents <= 0n) {
      rejected.push({ orderId: order.id, reason: "queued order has no notional" });
      continue;
    }
    try {
      const result = await deps.broker.submitNotionalOrder({
        accountId: customer.brokerAccountId,
        clientOrderId: order.clientOrderId,
        symbol: order.symbol,
        notionalCents,
        side: order.side,
      });
      await deps.orders.markSubmitted(order.id, result.providerOrderId);
      submitted += 1;
    } catch (error) {
      if (isBrokerOutage(error)) {
        stillQueued += 1;
        // The rail is still down; stop hammering it this round.
        break;
      }
      rejected.push({ orderId: order.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { attempted: queued.length, submitted, stillQueued, rejected };
}
