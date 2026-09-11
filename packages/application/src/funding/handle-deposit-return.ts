import { businessDate, microUnits, parseDecimal, postingPatterns, valuePosition } from "@corgi/domain";
import { NotFoundError, ValidationError } from "../errors.js";
import { deriveCustomerBalances } from "../ledger/balances.js";
import { postJournalEntry } from "../ledger/post-entry.js";
import { fileApproval } from "../operations/approvals.js";
import type {
  AccountResolver,
  ActorDirectory,
  ApprovalRepository,
  CustomerRepository,
  LedgerAccountDirectory,
  PriceRepository,
} from "../ports.js";
import { type RecordTransferEventDeps, type TransferEvent, recordTransferEvent } from "./record-transfer-event.js";

export interface HandleDepositReturnDeps extends RecordTransferEventDeps {
  readonly customers: CustomerRepository;
  readonly approvals: ApprovalRepository;
  readonly actors: ActorDirectory;
  readonly accounts: LedgerAccountDirectory;
  readonly prices: PriceRepository;
}

export type DepositReturnResult =
  | { readonly status: "reversed"; readonly shortfallCents: 0n }
  | { readonly status: "blocked"; readonly shortfallCents: bigint; readonly approvalId: string | null };

/**
 * A returned deposit (e.g. ACH R01) reverses the cash. If the customer had
 * already invested it, settled cash goes negative: the firm has covered the
 * gap. We stop trading and file a sell-to-cover request for a human to
 * approve — nothing is sold automatically (ADR-0005, ASSUMPTIONS).
 */
export async function handleDepositReturn(deps: HandleDepositReturnDeps, event: TransferEvent): Promise<DepositReturnResult> {
  if (event.kind !== "returned") throw new ValidationError("handleDepositReturn only handles returned transfers");
  await recordTransferEvent(deps, event);

  const now = deps.clock.now();
  const symbols = await deps.accounts.positionSymbols(event.customerId);
  const accounts = await deps.resolver.forCustomer(event.customerId, symbols);
  const balances = await deriveCustomerBalances({ ledger: deps.ledger }, event.customerId, accounts, symbols, { effectiveAt: now, publishedAt: now });
  if (balances.settledCents >= 0n) return { status: "reversed", shortfallCents: 0n };

  const shortfallCents = -balances.settledCents;
  await deps.customers.setTradingBlocked(event.customerId, true);

  // One request per returned transfer, however many times the event is replayed.
  const pending = await deps.approvals.list({ status: "pending" });
  const existing = pending.find((r) => r.kind === "order" && r.payload.intent === "sell_to_cover" && r.payload.transferId === event.transferId);
  if (existing) return { status: "blocked", shortfallCents, approvalId: existing.id };

  const symbol = await largestPosition(deps, balances.positionsMicro, businessDate(now));
  if (!symbol) return { status: "blocked", shortfallCents, approvalId: null };

  const system = await deps.actors.findByRole("system");
  if (!system) throw new NotFoundError("Seed the system actor before handling returned deposits");
  const request = await fileApproval(deps, {
    kind: "order",
    amountCents: shortfallCents,
    payload: {
      customerId: event.customerId,
      symbol,
      side: "sell",
      notionalCents: shortfallCents.toString(),
      intent: "sell_to_cover",
      ...(event.returnCode ? { returnCode: event.returnCode } : {}),
      transferId: event.transferId,
    },
    requestedBy: { id: system.id, actorType: system.actorType },
  });
  return { status: "blocked", shortfallCents, approvalId: request.id };
}

async function largestPosition(deps: HandleDepositReturnDeps, positions: ReadonlyMap<string, bigint>, asOf: string): Promise<string | null> {
  const held = [...positions.keys()];
  if (held.length === 0) return null;
  const closes = await deps.prices.latestCloses(held, asOf);
  let best: { symbol: string; value: bigint } | null = null;
  for (const symbol of held) {
    const close = closes.get(symbol);
    // Without a price fall back to units so a position is still nominated.
    const value = close ? valuePosition(microUnits(positions.get(symbol)!), parseDecimal(close.price, 8)) : positions.get(symbol)!;
    if (!best || value > best.value) best = { symbol, value };
  }
  return best?.symbol ?? null;
}

export interface ReleaseTradingBlockDeps extends RecordTransferEventDeps {
  readonly customers: CustomerRepository;
}

/**
 * Human close-out once the customer's cash is whole again: cancels the sweep
 * claim against the bounce receivable and lifts the trading block.
 */
export async function releaseTradingBlock(deps: ReleaseTradingBlockDeps, input: { customerId: string; actorId: string }) {
  const customer = await deps.customers.findById(input.customerId);
  if (!customer) throw new NotFoundError("Customer not found");
  const now = deps.clock.now();
  const accounts = await deps.resolver.forCustomer(input.customerId, []);
  const clearing = await deps.resolver.clearing([]);
  const balances = await deriveCustomerBalances({ ledger: deps.ledger }, input.customerId, accounts, [], { effectiveAt: now, publishedAt: now });
  if (balances.settledCents < 0n) {
    throw new ValidationError(`Settled cash is still short by ${-balances.settledCents} cents; wait for the sell to settle`);
  }
  let recoveredCents = 0n;
  if (balances.bounceRecoveryCents > 0n) {
    recoveredCents = balances.bounceRecoveryCents;
    await postJournalEntry(deps, {
      idempotencyKey: `bounce:recovered:${input.customerId}:${businessDate(now)}`,
      kind: "bounce_recovered",
      effectiveAt: now,
      source: "ops",
      sourceRef: input.actorId,
      description: "Returned-deposit recovery closed",
      postings: postingPatterns.bounceRecovered(accounts, clearing, recoveredCents),
    });
  }
  await deps.customers.setTradingBlocked(input.customerId, false);
  return { customerId: input.customerId, recoveredCents, tradingBlocked: false };
}
