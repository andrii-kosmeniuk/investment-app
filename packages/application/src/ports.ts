import type {
  ApprovalRequest,
  JournalEntry,
  OrderState,
  ReconBreak,
} from "@corgi/domain";

export interface UnitOfWork {
  execute<T>(operation: () => Promise<T>): Promise<T>;
}

export interface LedgerRepository {
  append(entry: JournalEntry): Promise<"inserted" | "duplicate">;
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

export interface ReconciliationRepository {
  saveBreaks(breaks: readonly ReconBreak[]): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}
