import type {
  AppendableEntry,
  ApprovalRequest,
  ClearingAccounts,
  CustomerLedgerAccounts,
  JournalEntry,
  LotAvailability,
  OrderState,
  ReconBreak,
  TaxLot,
} from "@corgi/domain";

export interface UnitOfWork {
  execute<T>(operation: () => Promise<T>): Promise<T>;
}

export interface AppendResult {
  readonly status: "inserted" | "duplicate";
  readonly entry: JournalEntry;
}

export interface LedgerRepository {
  /**
   * Seals an entry onto the tip of the hash chain and persists it atomically.
   * Implementations MUST serialize concurrent appends (so the head-hash read
   * and the insert cannot interleave) and MUST be idempotent on
   * `idempotencyKey`: a replay returns the already-stored entry as
   * `"duplicate"` instead of forking the chain.
   */
  append(entry: AppendableEntry): Promise<AppendResult>;
  findByIdempotencyKey(key: string): Promise<JournalEntry | null>;
  listForCustomer(
    customerId: string,
    cutoff: { effectiveAt: Date; publishedAt: Date },
  ): Promise<readonly JournalEntry[]>;
}

export interface InboxEvent {
  readonly provider: "alpaca" | "plaid" | "persona" | "custodian";
  readonly externalId: string;
  readonly dedupeKey: string;
  readonly type: string;
  readonly payload: unknown;
  readonly signatureValid: boolean;
  readonly receivedAt: Date;
}

export interface InboxRepository {
  receive(event: InboxEvent): Promise<"inserted" | "duplicate">;
  leaseBatch(limit: number): Promise<readonly InboxEvent[]>;
  markProcessed(dedupeKey: string): Promise<void>;
  markFailed(dedupeKey: string, error: string): Promise<void>;
}

export interface BrokerPort {
  createAccount(customerId: string): Promise<{ accountId: string; status: string }>;
  submitNotionalOrder(input: {
    accountId: string;
    clientOrderId: string;
    symbol: string;
    notionalCents: bigint;
    side: "buy" | "sell";
  }): Promise<{ providerOrderId: string; status: OrderState }>;
  getPositions(accountId: string): Promise<readonly BrokerPosition[]>;
  streamTradeEvents(cursor?: string): AsyncIterable<ProviderEvent>;
}

export interface BrokerPosition {
  readonly symbol: string;
  readonly unitsMicro: bigint;
}

export interface FundingPort {
  createLinkToken(customerId: string): Promise<string>;
  createDeposit(input: {
    customerId: string;
    bankAccountId: string;
    amountCents: bigint;
    idempotencyKey: string;
  }): Promise<{ transferId: string; status: string }>;
  syncEvents(cursor?: string): Promise<{
    events: readonly ProviderEvent[];
    nextCursor: string;
  }>;
}

export interface IdentityPort {
  createInquiry(customerId: string): Promise<{ inquiryId: string; sessionToken: string }>;
  getStatus(inquiryId: string): Promise<"pending" | "needs_review" | "approved" | "declined">;
}

export interface MarketDataPort {
  getDailyCloses(input: {
    symbols: readonly string[];
    from: string;
    to: string;
  }): Promise<readonly DailyClose[]>;
}

export interface DailyClose {
  readonly symbol: string;
  readonly tradeDate: string;
  readonly price: string;
  readonly source: string;
}

export interface ProviderEvent {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: Date;
  readonly payload: unknown;
  readonly cursor?: string;
}

export interface ApprovalRepository {
  create(request: ApprovalRequest): Promise<void>;
  listPending(): Promise<readonly ApprovalRequest[]>;
}

export type KycStatus = "not_started" | "pending" | "needs_review" | "approved" | "declined";

export interface CustomerRecord {
  readonly id: string;
  readonly kycStatus: KycStatus;
  readonly tradingBlocked: boolean;
  readonly brokerAccountId: string | null;
}

export interface CustomerRepository {
  findById(id: string): Promise<CustomerRecord | null>;
  setKycStatus(id: string, status: KycStatus, tradingBlocked: boolean): Promise<void>;
}

export interface OrderRecord {
  readonly id: string;
  readonly customerId: string;
  readonly clientOrderId: string;
  readonly providerOrderId: string | null;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly state: OrderState;
  readonly cumulativeFilledUnitsMicro: bigint;
}

export interface OrderRepository {
  create(order: {
    id: string;
    customerId: string;
    clientOrderId: string;
    providerOrderId: string | null;
    symbol: string;
    side: "buy" | "sell";
    state: OrderState;
    requestedNotionalCents: bigint;
  }): Promise<void>;
  findByClientOrderId(clientOrderId: string): Promise<OrderRecord | null>;
  findByProviderOrderId(providerOrderId: string): Promise<OrderRecord | null>;
  recordFill(input: {
    orderId: string;
    externalId: string;
    state: OrderState;
    cumulativeFilledUnitsMicro: bigint;
    payload: unknown;
    occurredAt: Date;
  }): Promise<void>;
}

export interface TaxLotRepository {
  open(lot: TaxLot): Promise<void>;
  availableLots(customerId: string, symbol: string): Promise<readonly LotAvailability[]>;
}

/**
 * Resolves the stable ledger account IDs for a customer and the firm. The
 * caller declares which position symbols it needs so per-symbol accounts can be
 * ensured up front, keeping the returned `position()` lookup synchronous.
 */
export interface AccountResolver {
  forCustomer(customerId: string, symbols: readonly string[]): Promise<CustomerLedgerAccounts>;
  clearing(symbols: readonly string[]): Promise<ClearingAccounts>;
}

export interface ReconciliationRepository {
  saveBreaks(breaks: readonly ReconBreak[]): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}
