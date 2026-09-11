import {
  type LotConsumption,
  businessDate,
  canTransitionOrder,
  cents,
  consumeFifo,
  contractualSettlementDate,
  incrementalFillUnits,
  microUnits,
  postingPatterns,
  valuePosition,
} from "@corgi/domain";
import type {
  AccountResolver,
  OrderRecord,
  OrderRepository,
  SettlementRepository,
  TaxLotRepository,
} from "../ports.js";
import { type PostJournalEntryDeps, postJournalEntry } from "../ledger/post-entry.js";

export interface FillEvent {
  readonly executionId: string;
  readonly providerOrderId: string;
  readonly symbol: string;
  /** Cumulative filled units reported by the broker (micro-units). */
  readonly cumulativeUnitsMicro: bigint;
  /** Fill price scaled to 8 decimals. */
  readonly priceE8: bigint;
  readonly occurredAt: Date;
  /** True on a terminal `fill`, false on a `partial_fill`. */
  readonly terminal: boolean;
}

export interface ApplyFillDeps extends PostJournalEntryDeps {
  readonly resolver: AccountResolver;
  readonly orders: OrderRepository;
  readonly taxLots: TaxLotRepository;
  readonly settlements: SettlementRepository;
  /** Exchange holidays (YYYY-MM-DD); empty this week — weekends only (ADR-0005). */
  readonly holidays?: ReadonlySet<string>;
}

/**
 * Applies a broker fill to the ledger, opens (buy) or consumes (sell) tax lots
 * and records the T+1 settlement obligation. Uses cumulative fill accounting:
 * only the incremental units since the last known cumulative are booked, so a
 * `partial_fill` re-delivered after a `fill` is ignored. Lots, settlement and
 * order state only move when the ledger append actually inserted, so a
 * replayed execution never double-books anything.
 */
export async function applyFill(deps: ApplyFillDeps, fill: FillEvent): Promise<void> {
  const order = await deps.orders.findByProviderOrderId(fill.providerOrderId);
  if (!order) throw new Error(`unknown order for provider id: ${fill.providerOrderId}`);

  const incremental = incrementalFillUnits(order.cumulativeFilledUnitsMicro, {
    executionId: fill.executionId,
    cumulativeUnits: fill.cumulativeUnitsMicro,
    priceCents: 0n,
  });
  if (incremental <= 0n) return;

  const amountCents = valuePosition(microUnits(incremental), fill.priceE8);
  const entryId = deps.ids.next();
  const booked =
    order.side === "buy"
      ? await bookBuy(deps, order, fill, entryId, incremental, amountCents)
      : await bookSell(deps, order, fill, entryId, incremental, amountCents);
  if (!booked) return;

  const tradeDate = businessDate(fill.occurredAt);
  await deps.settlements.record({
    id: deps.ids.next(),
    orderId: order.id,
    fillExternalId: fill.executionId,
    side: order.side,
    amountCents,
    tradeDate,
    contractualSettlementDate: contractualSettlementDate(tradeDate, deps.holidays ?? new Set()),
    status: "pending",
    journalEntryId: entryId,
  });

  const nextState = fill.terminal ? "filled" : "partially_filled";
  await deps.orders.recordFill({
    orderId: order.id,
    externalId: fill.executionId,
    state: canTransitionOrder(order.state, nextState) ? nextState : order.state,
    cumulativeFilledUnitsMicro: fill.cumulativeUnitsMicro,
    payload: fill,
    occurredAt: fill.occurredAt,
  });
}

async function bookBuy(
  deps: ApplyFillDeps,
  order: OrderRecord,
  fill: FillEvent,
  entryId: string,
  unitsMicro: bigint,
  costCents: bigint,
): Promise<boolean> {
  const customer = await deps.resolver.forCustomer(order.customerId, [fill.symbol]);
  const clearing = await deps.resolver.clearing([fill.symbol]);
  const lotId = deps.ids.next();

  const result = await postJournalEntry(deps, {
    id: entryId,
    idempotencyKey: `alpaca:fill:${fill.executionId}`,
    kind: "buy_fill",
    effectiveAt: fill.occurredAt,
    source: "alpaca",
    sourceRef: fill.executionId,
    description: `Buy ${fill.symbol}`,
    postings: postingPatterns.buyFill(customer, clearing, fill.symbol, microUnits(unitsMicro), costCents, lotId),
  });
  if (result.status !== "inserted") return false;

  await deps.taxLots.open({
    id: lotId,
    customerId: order.customerId,
    symbol: fill.symbol,
    openedEntryId: entryId,
    openedAt: fill.occurredAt,
    units: microUnits(unitsMicro),
    basis: cents(costCents),
  });
  return true;
}

async function bookSell(
  deps: ApplyFillDeps,
  order: OrderRecord,
  fill: FillEvent,
  entryId: string,
  unitsMicro: bigint,
  proceedsCents: bigint,
): Promise<boolean> {
  const customer = await deps.resolver.forCustomer(order.customerId, [fill.symbol]);
  const clearing = await deps.resolver.clearing([fill.symbol]);
  // FIFO is decided before the append so an insufficient position fails loudly
  // and leaves no half-booked entry behind.
  const lots = await deps.taxLots.availableLots(order.customerId, fill.symbol);
  const consumptions: readonly LotConsumption[] = consumeFifo(lots, microUnits(unitsMicro), cents(proceedsCents), fill.occurredAt);

  const result = await postJournalEntry(deps, {
    id: entryId,
    idempotencyKey: `alpaca:fill:${fill.executionId}`,
    kind: "sell_fill",
    effectiveAt: fill.occurredAt,
    source: "alpaca",
    sourceRef: fill.executionId,
    description: `Sell ${fill.symbol}`,
    postings: postingPatterns.sellFill(customer, clearing, fill.symbol, microUnits(unitsMicro), proceedsCents),
  });
  if (result.status !== "inserted") return false;

  await deps.taxLots.consume(
    consumptions.map((consumption) => ({
      ...consumption,
      id: deps.ids.next(),
      sellEntryId: entryId,
      consumedAt: fill.occurredAt,
    })),
  );
  return true;
}
