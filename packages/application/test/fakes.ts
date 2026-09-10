import {
  type AppendableEntry,
  type ApprovalRequest,
  type ClearingAccounts,
  type CustomerLedgerAccounts,
  type JournalEntry,
  type LotAvailability,
  type TaxLot,
  sealNext,
} from "@corgi/domain";
import type {
  AccountResolver,
  AppendResult,
  ApprovalRepository,
  BrokerPort,
  BrokerPosition,
  Clock,
  CustomerRecord,
  CustomerRepository,
  IdGenerator,
  InboxEvent,
  InboxRepository,
  KycStatus,
  LedgerRepository,
  OrderRecord,
  OrderRepository,
  ProviderEvent,
  TaxLotRepository,
} from "../src/index.js";

/**
 * Single-threaded, in-memory stand-in for the real Drizzle ledger. It applies
 * the same append contract the port requires — seal onto the chain tip and
 * dedupe on idempotency key — so use-case tests exercise the real semantics
 * without a database. Concurrency (the advisory lock) is a persistence concern
 * verified against Postgres, not here.
 */
export class InMemoryLedgerRepository implements LedgerRepository {
  private readonly entries: JournalEntry[] = [];
  private readonly byKey = new Map<string, JournalEntry>();
  private tip: string | null = null;

  append(entry: AppendableEntry): Promise<AppendResult> {
    const existing = this.byKey.get(entry.idempotencyKey);
    if (existing) return Promise.resolve({ status: "duplicate", entry: existing });

    const sealed = sealNext(this.tip, entry);
    this.entries.push(sealed);
    this.byKey.set(sealed.idempotencyKey, sealed);
    this.tip = sealed.hash;
    return Promise.resolve({ status: "inserted", entry: sealed });
  }

  findByIdempotencyKey(key: string): Promise<JournalEntry | null> {
    return Promise.resolve(this.byKey.get(key) ?? null);
  }

  listForCustomer(
    _customerId: string,
    cutoff: { effectiveAt: Date; publishedAt: Date },
  ): Promise<readonly JournalEntry[]> {
    return Promise.resolve(
      this.entries.filter(
        (entry) =>
          entry.effectiveAt <= cutoff.effectiveAt && entry.postedAt <= cutoff.publishedAt,
      ),
    );
  }

  get all(): readonly JournalEntry[] {
    return this.entries;
  }
}

export class InMemoryInboxRepository implements InboxRepository {
  private readonly events = new Map<string, InboxEvent>();
  private readonly processed = new Set<string>();
  readonly failures = new Map<string, string>();

  receive(event: InboxEvent): Promise<"inserted" | "duplicate"> {
    if (this.events.has(event.dedupeKey)) return Promise.resolve("duplicate");
    this.events.set(event.dedupeKey, event);
    return Promise.resolve("inserted");
  }

  leaseBatch(limit: number): Promise<readonly InboxEvent[]> {
    const pending = [...this.events.values()].filter(
      (event) => !this.processed.has(event.dedupeKey),
    );
    return Promise.resolve(pending.slice(0, limit));
  }

  markProcessed(dedupeKey: string): Promise<void> {
    this.processed.add(dedupeKey);
    this.failures.delete(dedupeKey);
    return Promise.resolve();
  }

  markFailed(dedupeKey: string, error: string): Promise<void> {
    this.failures.set(dedupeKey, error);
    return Promise.resolve();
  }
}

export function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) };
}

export function sequentialIds(prefix = "entry"): IdGenerator {
  let counter = 0;
  return {
    next: () => {
      counter += 1;
      return `${prefix}-${counter}`;
    },
  };
}

export function staticResolver(): AccountResolver {
  return {
    forCustomer: (customerId) =>
      Promise.resolve({
        settledCash: `${customerId}:settled`,
        pendingDeposit: `${customerId}:pending`,
        unsettledBuys: `${customerId}:unsettled-buys`,
        unsettledSells: `${customerId}:unsettled-sells`,
        dividendReceivable: `${customerId}:div-recv`,
        bounceRecovery: `${customerId}:bounce`,
        dividendIncome: `${customerId}:div-income`,
        feeExpense: `${customerId}:fee`,
        position: (symbol) => `${customerId}:pos:${symbol}`,
      } satisfies CustomerLedgerAccounts),
    clearing: () =>
      Promise.resolve({
        plaidSweep: "firm:sweep",
        tradingUsd: "firm:trading-usd",
        rounding: "firm:rounding",
        tradingUnits: (symbol) => `firm:trading:${symbol}`,
        custodianStreet: (symbol) => `firm:street:${symbol}`,
      } satisfies ClearingAccounts),
  };
}

export class FakeCustomerRepository implements CustomerRepository {
  private readonly customers = new Map<string, CustomerRecord>();

  constructor(seed: readonly CustomerRecord[] = []) {
    for (const customer of seed) this.customers.set(customer.id, customer);
  }

  findById(id: string): Promise<CustomerRecord | null> {
    return Promise.resolve(this.customers.get(id) ?? null);
  }

  setKycStatus(id: string, status: KycStatus, tradingBlocked: boolean): Promise<void> {
    const existing = this.customers.get(id);
    if (!existing) throw new Error(`unknown customer ${id}`);
    this.customers.set(id, { ...existing, kycStatus: status, tradingBlocked });
    return Promise.resolve();
  }

  snapshot(id: string): CustomerRecord | undefined {
    return this.customers.get(id);
  }
}

export class FakeOrderRepository implements OrderRepository {
  private readonly byClientId = new Map<string, OrderRecord>();
  private readonly byProviderId = new Map<string, OrderRecord>();

  create(order: {
    id: string;
    customerId: string;
    clientOrderId: string;
    providerOrderId: string | null;
    symbol: string;
    side: "buy" | "sell";
    state: OrderRecord["state"];
    requestedNotionalCents: bigint;
  }): Promise<void> {
    const record: OrderRecord = {
      id: order.id,
      customerId: order.customerId,
      clientOrderId: order.clientOrderId,
      providerOrderId: order.providerOrderId,
      symbol: order.symbol,
      side: order.side,
      state: order.state,
      cumulativeFilledUnitsMicro: 0n,
    };
    this.byClientId.set(order.clientOrderId, record);
    if (order.providerOrderId) this.byProviderId.set(order.providerOrderId, record);
    return Promise.resolve();
  }

  seed(record: OrderRecord): void {
    this.byClientId.set(record.clientOrderId, record);
    if (record.providerOrderId) this.byProviderId.set(record.providerOrderId, record);
  }

  findByClientOrderId(clientOrderId: string): Promise<OrderRecord | null> {
    return Promise.resolve(this.byClientId.get(clientOrderId) ?? null);
  }

  findByProviderOrderId(providerOrderId: string): Promise<OrderRecord | null> {
    return Promise.resolve(this.byProviderId.get(providerOrderId) ?? null);
  }

  recordFill(input: {
    orderId: string;
    externalId: string;
    state: OrderRecord["state"];
    cumulativeFilledUnitsMicro: bigint;
    payload: unknown;
    occurredAt: Date;
  }): Promise<void> {
    for (const store of [this.byClientId, this.byProviderId]) {
      for (const [key, record] of store) {
        if (record.id === input.orderId) {
          store.set(key, {
            ...record,
            state: input.state,
            cumulativeFilledUnitsMicro: input.cumulativeFilledUnitsMicro,
          });
        }
      }
    }
    return Promise.resolve();
  }
}

export class FakeTaxLotRepository implements TaxLotRepository {
  readonly lots: TaxLot[] = [];

  open(lot: TaxLot): Promise<void> {
    this.lots.push(lot);
    return Promise.resolve();
  }

  availableLots(customerId: string, symbol: string): Promise<readonly LotAvailability[]> {
    return Promise.resolve(
      this.lots
        .filter((lot) => lot.customerId === customerId && lot.symbol === symbol)
        .map((lot) => ({ lot, remainingUnits: lot.units, remainingBasis: lot.basis })),
    );
  }
}

export class FakeApprovalRepository implements ApprovalRepository {
  readonly requests: ApprovalRequest[] = [];

  create(request: ApprovalRequest): Promise<void> {
    this.requests.push(request);
    return Promise.resolve();
  }

  listPending(): Promise<readonly ApprovalRequest[]> {
    return Promise.resolve(this.requests.filter((request) => request.status === "pending"));
  }
}

export class FakeBroker implements BrokerPort {
  readonly submitted: Array<{ clientOrderId: string; symbol: string; notionalCents: bigint }> = [];

  createAccount(customerId: string): Promise<{ accountId: string; status: string }> {
    return Promise.resolve({ accountId: `acct-${customerId}`, status: "ACTIVE" });
  }

  submitNotionalOrder(input: {
    accountId: string;
    clientOrderId: string;
    symbol: string;
    notionalCents: bigint;
    side: "buy" | "sell";
  }): Promise<{ providerOrderId: string; status: "submitted" }> {
    this.submitted.push({
      clientOrderId: input.clientOrderId,
      symbol: input.symbol,
      notionalCents: input.notionalCents,
    });
    return Promise.resolve({ providerOrderId: `prov-${input.clientOrderId}`, status: "submitted" });
  }

  getPositions(): Promise<readonly BrokerPosition[]> {
    return Promise.resolve([]);
  }

  async *streamTradeEvents(): AsyncIterable<ProviderEvent> {
    // no events in tests
  }
}
