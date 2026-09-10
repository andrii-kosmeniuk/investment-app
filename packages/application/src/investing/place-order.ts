import { InsufficientFundsError, OrderNotPermittedError } from "../errors.js";
import type {
  ApprovalRepository,
  BrokerPort,
  Clock,
  CustomerRepository,
  IdGenerator,
  OrderRepository,
} from "../ports.js";

export interface PlaceOrderCommand {
  readonly customerId: string;
  readonly symbol: string;
  readonly notionalCents: bigint;
  readonly side: "buy" | "sell";
  readonly requestedByActorId: string;
  /**
   * The customer has explicitly confirmed this order in the product (design
   * brief §9.5). Satisfies the confirmation threshold; the ops maker-checker
   * queue is for money-out and bulk rebalances, not a customer's own buys.
   */
  readonly customerConfirmed?: boolean;
}

export interface PlaceOrderDeps {
  readonly customers: CustomerRepository;
  readonly orders: OrderRepository;
  readonly broker: BrokerPort;
  readonly approvals: ApprovalRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Available-to-trade cents for the customer (settled − unsettled buys + unsettled sells). */
  readonly getAvailableToTradeCents: (customerId: string) => Promise<bigint>;
  /** Orders at or above this notional need a second-actor approval. */
  readonly confirmationThresholdCents: bigint;
}

export type PlaceOrderResult =
  | { readonly status: "submitted"; readonly orderId: string; readonly providerOrderId: string }
  | { readonly status: "pending_approval"; readonly approvalId: string };

/**
 * Places a notional order after enforcing the customer-facing controls: KYC
 * must be approved and trading unblocked, buys must fit available-to-trade, and
 * anything at/above the confirmation threshold is diverted to the maker-checker
 * queue instead of being submitted.
 */
export async function placeOrder(
  deps: PlaceOrderDeps,
  command: PlaceOrderCommand,
): Promise<PlaceOrderResult> {
  const customer = await deps.customers.findById(command.customerId);
  if (!customer) throw new Error(`unknown customer: ${command.customerId}`);
  if (customer.kycStatus !== "approved" || customer.tradingBlocked) {
    throw new OrderNotPermittedError("Customer is not permitted to trade");
  }
  if (!customer.brokerAccountId) {
    throw new OrderNotPermittedError("Customer has no broker account");
  }

  if (command.side === "buy") {
    const available = await deps.getAvailableToTradeCents(command.customerId);
    if (command.notionalCents > available) {
      throw new InsufficientFundsError(
        `Order of ${command.notionalCents} exceeds available ${available}`,
      );
    }
  }

  if (command.notionalCents >= deps.confirmationThresholdCents && !command.customerConfirmed) {
    const approvalId = deps.ids.next();
    await deps.approvals.create({
      id: approvalId,
      kind: "order",
      amountCents: command.notionalCents,
      requestedByActorId: command.requestedByActorId,
      requestedByActorType: "human",
      status: "pending",
      payload: {
        customerId: command.customerId,
        symbol: command.symbol,
        side: command.side,
        notionalCents: command.notionalCents.toString(),
      },
    });
    return { status: "pending_approval", approvalId };
  }

  const clientOrderId = deps.ids.next();
  const submitted = await deps.broker.submitNotionalOrder({
    accountId: customer.brokerAccountId,
    clientOrderId,
    symbol: command.symbol,
    notionalCents: command.notionalCents,
    side: command.side,
  });

  const orderId = deps.ids.next();
  await deps.orders.create({
    id: orderId,
    customerId: command.customerId,
    clientOrderId,
    providerOrderId: submitted.providerOrderId,
    symbol: command.symbol,
    side: command.side,
    state: submitted.status,
    requestedNotionalCents: command.notionalCents,
  });

  return { status: "submitted", orderId, providerOrderId: submitted.providerOrderId };
}
