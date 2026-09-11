import { postingPatterns } from "@corgi/domain";
import { InsufficientFundsError, ValidationError } from "../errors.js";
import { deriveCustomerBalances } from "../ledger/balances.js";
import { type PostJournalEntryDeps, postJournalEntry } from "../ledger/post-entry.js";
import { type PlaceOrderDeps, placeOrder } from "../investing/place-order.js";
import type { AccountResolver, ApprovalRepository, BrokerPort, CustomerRepository, OrderRepository, ReconciliationRepository } from "../ports.js";
import { type ApprovalExecutors, type ApprovalOutcome, payloadOf } from "./approvals.js";
import { applyBreakAdjustment } from "./reconciliation.js";

export interface ApprovalExecutorDeps extends PostJournalEntryDeps {
  readonly resolver: AccountResolver;
  readonly customers: CustomerRepository;
  readonly orders: OrderRepository;
  readonly approvals: ApprovalRepository;
  readonly reconciliation: ReconciliationRepository;
  /** Null when the broker is not configured: order and rebalance approvals then fail loudly. */
  readonly broker: BrokerPort | null;
  readonly confirmationThresholdCents: bigint;
}

/**
 * What "approved" does, per request kind. Each executor reads only the frozen
 * payload and runs through the same use-cases the rest of the product uses;
 * none of them writes a table directly (ADR-0005).
 */
export function buildApprovalExecutors(deps: ApprovalExecutorDeps): ApprovalExecutors {
  const orderDeps = (): PlaceOrderDeps => {
    if (!deps.broker) throw new ValidationError("Broker is not configured in this environment");
    return {
      customers: deps.customers,
      orders: deps.orders,
      broker: deps.broker,
      approvals: deps.approvals,
      clock: deps.clock,
      ids: deps.ids,
      confirmationThresholdCents: deps.confirmationThresholdCents,
      getAvailableToTradeCents: async (customerId) => {
        const now = deps.clock.now();
        const accounts = await deps.resolver.forCustomer(customerId, []);
        const balances = await deriveCustomerBalances({ ledger: deps.ledger }, customerId, accounts, [], { effectiveAt: now, publishedAt: now });
        return balances.availableToTradeCents;
      },
    };
  };

  return {
    async withdrawal(request): Promise<ApprovalOutcome> {
      const payload = payloadOf(request, "withdrawal");
      const customer = await deps.resolver.forCustomer(payload.customerId, []);
      const clearing = await deps.resolver.clearing([]);
      const result = await postJournalEntry(deps, {
        idempotencyKey: `approval:${request.id}`,
        kind: "withdrawal",
        effectiveAt: deps.clock.now(),
        source: "ops",
        sourceRef: request.id,
        description: `Withdrawal approved · ${payload.reason}`,
        postings: postingPatterns.withdrawal(customer, clearing, request.amountCents),
      });
      // The ledger leg is booked; the bank payout rail is on the cut list.
      return { entryId: result.entry.id, entry: result.status, amountCents: request.amountCents.toString(), payout: "not_sent" };
    },

    async order(request): Promise<ApprovalOutcome> {
      const payload = payloadOf(request, "order");
      const placed = await placeOrder(orderDeps(), {
        customerId: payload.customerId,
        symbol: payload.symbol,
        side: payload.side,
        notionalCents: BigInt(payload.notionalCents),
        requestedByActorId: request.requestedByActorId,
        customerConfirmed: true, // the approval *is* the confirmation
        firmInitiatedSell: payload.intent === "sell_to_cover",
      });
      return placed.status === "submitted"
        ? { orderId: placed.orderId, providerOrderId: placed.providerOrderId, symbol: payload.symbol, side: payload.side, intent: payload.intent ?? null }
        : { approvalId: placed.approvalId, status: "pending_approval" };
    },

    async rebalance(request): Promise<ApprovalOutcome> {
      const payload = payloadOf(request, "rebalance");
      const ordered = [...payload.legs].sort((a, b) => (a.side === b.side ? 0 : a.side === "sell" ? -1 : 1));
      const submitted: string[] = [];
      const deferred: string[] = [];
      for (const leg of ordered) {
        try {
          const placed = await placeOrder(orderDeps(), {
            customerId: payload.customerId,
            symbol: leg.symbol,
            side: leg.side,
            notionalCents: BigInt(leg.notionalCents),
            requestedByActorId: request.requestedByActorId,
            customerConfirmed: true,
          });
          if (placed.status === "submitted") submitted.push(`${leg.side} ${leg.symbol}`);
        } catch (error) {
          // A buy that does not fit until the sells settle is deferred, not failed.
          if (error instanceof InsufficientFundsError && leg.side === "buy") deferred.push(`${leg.side} ${leg.symbol}`);
          else throw error;
        }
      }
      return { legs: payload.legs.length, submitted: submitted.join(", ") || "none", deferredUntilSellsSettle: deferred.join(", ") || "none" };
    },

    recon_adjustment: (request, decidedBy) => applyBreakAdjustment(deps, request, decidedBy),
  };
}
