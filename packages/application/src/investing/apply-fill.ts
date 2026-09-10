import {
  canTransitionOrder,
  incrementalFillUnits,
  microUnits,
  postingPatterns,
  valuePosition,
} from "@corgi/domain";
import type { AccountResolver, OrderRepository, TaxLotRepository } from "../ports.js";
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
}

/**
 * Applies a broker fill to the ledger and opens the tax lot. Uses cumulative
 * fill accounting: only the incremental units since the last known cumulative
 * are booked, so a `partial_fill` re-delivered after a `fill` is ignored. The
 * lot and order update only run when the ledger append actually inserted, so a
 * replayed execution never double-books a lot.
 */
export async function applyFill(deps: ApplyFillDeps, fill: FillEvent): Promise<void> {
  const order = await deps.orders.findByProviderOrderId(fill.providerOrderId);
  if (!order) throw new Error(`unknown order for provider id: ${fill.providerOrderId}`);
  if (order.side !== "buy") {
    throw new Error("sell fills are handled by the rebalancing flow");
  }

  const incremental = incrementalFillUnits(order.cumulativeFilledUnitsMicro, {
    executionId: fill.executionId,
    cumulativeUnits: fill.cumulativeUnitsMicro,
    priceCents: 0n,
  });
  if (incremental <= 0n) return;

  const costCents = valuePosition(microUnits(incremental), fill.priceE8);
  const customer = await deps.resolver.forCustomer(order.customerId, [fill.symbol]);
  const clearing = await deps.resolver.clearing([fill.symbol]);
  const entryId = deps.ids.next();
  const lotId = deps.ids.next();

  const result = await postJournalEntry(deps, {
    id: entryId,
    idempotencyKey: `alpaca:fill:${fill.executionId}`,
    kind: "buy_fill",
    effectiveAt: fill.occurredAt,
    source: "alpaca",
    sourceRef: fill.executionId,
    description: `Buy ${fill.symbol}`,
    postings: postingPatterns.buyFill(
      customer,
      clearing,
      fill.symbol,
      microUnits(incremental),
      costCents,
      lotId,
    ),
  });

  if (result.status !== "inserted") return;

  await deps.taxLots.open({
    id: lotId,
    customerId: order.customerId,
    symbol: fill.symbol,
    openedEntryId: entryId,
    openedAt: fill.occurredAt,
    units: microUnits(incremental),
    basis: costCents,
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
