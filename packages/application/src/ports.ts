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
  /** Trades the one-time Link public token for the durable item credentials. */
  exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }>;
  createDeposit(input: {
    customerId: string;
    /** Provider-side item credential for the linked bank. */
    accessToken: string;
    /** Provider-side account id within the item. */
    providerAccountId: string;
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
  /** Issues a fresh session token so an open inquiry can be continued. */
  resumeInquiry(inquiryId: string): Promise<{ sessionToken: string }>;
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

/** What the customer sees about themselves; never includes credentials. */
export interface CustomerProfile {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly kycStatus: KycStatus;
  readonly tradingBlocked: boolean;
}

export interface CustomerDirectory {
  findProfile(id: string): Promise<CustomerProfile | null>;
  findProfileByEmail(email: string): Promise<CustomerProfile | null>;
}

export interface CredentialsRepository {
  /** Returns the stored password hash for a customer, or null when none is set. */
  findPasswordHash(customerId: string): Promise<string | null>;
}

export interface IdentityInquiryRecord {
  readonly inquiryId: string;
  readonly customerId: string;
  readonly status: KycStatus;
  readonly createdAt: Date;
}

export interface IdentityInquiryRepository {
  latestForCustomer(customerId: string): Promise<IdentityInquiryRecord | null>;
  create(record: IdentityInquiryRecord): Promise<void>;
}

export interface BankAccountRecord {
  readonly id: string;
  readonly customerId: string;
  readonly providerAccountId: string;
  readonly providerAccessToken: string;
  readonly institutionName: string;
  readonly accountMask: string;
  readonly status: "active" | "disconnected";
  readonly createdAt: Date;
}

export interface BankAccountRepository {
  listForCustomer(customerId: string): Promise<readonly BankAccountRecord[]>;
  findById(id: string): Promise<BankAccountRecord | null>;
  create(record: BankAccountRecord): Promise<void>;
}

export type TransferDirection = "deposit" | "withdrawal";

export interface TransferRecord {
  readonly id: string;
  readonly customerId: string;
  readonly bankAccountId: string;
  readonly providerTransferId: string;
  readonly direction: TransferDirection;
  readonly amountCents: bigint;
  /** Provider status at creation; the ledger is the source of truth afterwards. */
  readonly status: string;
  readonly returnCode: string | null;
  readonly createdAt: Date;
}

export interface TransferRepository {
  create(record: TransferRecord): Promise<void>;
  listForCustomer(customerId: string): Promise<readonly TransferRecord[]>;
  findByProviderId(
    providerTransferId: string,
  ): Promise<{ customerId: string; amountCents: bigint } | null>;
}

export interface ModelAllocation {
  readonly symbol: string;
  readonly targetWeightBps: number;
  readonly minimumTradeCents: bigint;
  readonly fractionalAllowed: boolean;
}

export interface ModelDefinition {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly riskLevel: number;
  readonly cashBufferBps: number;
  readonly allocations: readonly ModelAllocation[];
}

export interface ModelCatalog {
  list(): Promise<readonly ModelDefinition[]>;
  findByCode(code: string): Promise<ModelDefinition | null>;
}

export interface PortfolioAssignment {
  readonly customerId: string;
  readonly modelId: string;
  readonly brokerAccountId: string;
  readonly status: "open" | "closed";
}

export interface PortfolioAssignmentRepository {
  findForCustomer(customerId: string): Promise<PortfolioAssignment | null>;
  /** Insert or replace the customer's single assignment. */
  assign(assignment: PortfolioAssignment): Promise<void>;
}

export interface LatestClose {
  readonly symbol: string;
  /** Decimal string, up to eight places. */
  readonly price: string;
  readonly tradeDate: string;
  readonly status: "final" | "stale";
}

export interface PriceRepository {
  latestCloses(symbols: readonly string[], asOf: string): Promise<ReadonlyMap<string, LatestClose>>;
}

export interface LedgerAccountDirectory {
  pathsById(accountIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** Symbols for which the customer has ever had a position account. */
  positionSymbols(customerId: string): Promise<readonly string[]>;
}

export interface OrderListing {
  listOpenForCustomer(customerId: string): Promise<readonly OpenOrder[]>;
}

export interface OpenOrder {
  readonly id: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly requestedNotionalCents: bigint;
  readonly state: OrderState;
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
