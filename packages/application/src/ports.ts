import type {
  ActorType,
  AppendableEntry,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalStatus,
  ClearingAccounts,
  CustomerLedgerAccounts,
  JournalEntry,
  LotAvailability,
  LotConsumption,
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

export interface ApprovalRequestRecord extends ApprovalRequest {
  readonly createdAt: Date;
}

export interface ApprovalDecisionRecord extends ApprovalDecision {
  readonly id: string;
  readonly decidedAt: Date;
}

export interface ApprovalRepository {
  create(request: ApprovalRequest): Promise<void>;
  findById(id: string): Promise<ApprovalRequestRecord | null>;
  /** Newest first; `status` narrows, `limit` caps. */
  list(filter: { status?: ApprovalStatus; limit?: number }): Promise<readonly ApprovalRequestRecord[]>;
  /**
   * Appends the decision row and moves the request to the decided status in
   * one unit. The database re-checks maker ≠ checker and human-only; a violation
   * surfaces as an error here even if the caller skipped the domain check.
   */
  recordDecision(decision: ApprovalDecisionRecord): Promise<void>;
  decisionFor(requestId: string): Promise<ApprovalDecisionRecord | null>;
}

export interface ActorRecord {
  readonly id: string;
  readonly displayName: string;
  readonly actorType: ActorType;
  readonly role: string;
}

export interface ActorDirectory {
  findById(id: string): Promise<ActorRecord | null>;
  /** Operators who may decide approvals. */
  listHumans(): Promise<readonly ActorRecord[]>;
  /** The single actor for a system role, e.g. `agent` (MCP) or `system` (automation). */
  findByRole(role: string): Promise<ActorRecord | null>;
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
  setTradingBlocked(id: string, blocked: boolean): Promise<void>;
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

export interface NewCustomer {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
}

/**
 * Self-serve registration (ADR-0006): creates the profile and its credential
 * in one unit of work. Throws `EmailTakenError` when the email is already
 * registered, relying on the database's uniqueness rather than a prior read.
 */
export interface CustomerRegistry {
  create(customer: NewCustomer): Promise<CustomerProfile>;
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
  /** Version of the close for that date; a corrected close is version 2+. */
  readonly version: number;
}

export interface StoredClose {
  readonly id: string;
  readonly symbol: string;
  readonly tradeDate: string;
  readonly price: string;
  readonly source: string;
  readonly version: number;
  readonly supersedesId: string | null;
  readonly receivedAt: Date;
}

export interface RecordedClose extends StoredClose {
  /** True when an earlier version existed for the same date with a different close. */
  readonly corrected: boolean;
}

export interface PriceRepository {
  /**
   * Latest usable close per symbol on or before `asOf` (highest version for
   * that date). Marks a close older than the staleness window as `stale`.
   */
  latestCloses(symbols: readonly string[], asOf: string): Promise<ReadonlyMap<string, LatestClose>>;
  /**
   * Persists closes. A close equal to the current version for its
   * (symbol, tradeDate) is a no-op; a different one becomes the next version
   * and points at the row it supersedes. Returns only the rows written.
   */
  record(closes: readonly DailyClose[], receivedAt: Date): Promise<readonly RecordedClose[]>;
  /** Current version of every stored close for `symbol` with tradeDate >= fromDate, ascending. */
  listForSymbol(symbol: string, fromDate: string): Promise<readonly StoredClose[]>;
}

export interface LedgerAccountDirectory {
  pathsById(accountIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  /** Symbols for which the customer has ever had a position account. */
  positionSymbols(customerId: string): Promise<readonly string[]>;
  /** Every symbol any customer has ever held — the universe the price feed must cover. */
  allPositionSymbols(): Promise<readonly string[]>;
  /** Customers with at least one ledger account — the population the valuation job values. */
  customersWithAccounts(): Promise<readonly string[]>;
  /** Customers with a position account for `symbol` (past or present). */
  customersHolding(symbol: string): Promise<readonly string[]>;
}

/* ------------------------------------------------------------------ */
/* Valuations and period returns — versioned, never updated             */
/* ------------------------------------------------------------------ */

export type ValuationStatus = "final" | "provisional";

export interface ValuationPositionSnapshot {
  readonly symbol: string;
  readonly unitsMicro: bigint;
  readonly price: string;
  readonly priceDate: string;
  readonly priceVersion: number;
  readonly priceStatus: "final" | "stale";
  readonly valueCents: bigint;
}

export interface ValuationRecord {
  readonly id: string;
  readonly customerId: string;
  readonly asOfDate: string;
  readonly valueCents: bigint;
  /** Net cash counted in the value: available-to-trade plus dividend receivable. */
  readonly cashCents: bigint;
  readonly positions: readonly ValuationPositionSnapshot[];
  readonly priceSetHash: string;
  readonly status: ValuationStatus;
  readonly version: number;
  readonly supersedesId: string | null;
  readonly reason: string | null;
  readonly computedAt: Date;
}

export interface ValuationRange {
  readonly from?: string;
  readonly to?: string;
  /** Knowledge cut-off: only versions computed at or before this instant ("as published"). */
  readonly publishedAt?: Date;
}

export interface ValuationRepository {
  /** Highest visible version per date, ascending by date. */
  series(customerId: string, range: ValuationRange): Promise<readonly ValuationRecord[]>;
  /** Every version for one date, ascending by version. */
  versions(customerId: string, asOfDate: string): Promise<readonly ValuationRecord[]>;
  insert(record: Omit<ValuationRecord, "computedAt">): Promise<ValuationRecord>;
  /** Superseding versions across all customers, newest first — the restatement audit. */
  listRestated(limit: number): Promise<readonly ValuationRecord[]>;
}

export type ReturnPeriod = "mtd" | "ytd" | "inception";

export interface PeriodReturnRecord {
  readonly id: string;
  readonly customerId: string;
  readonly period: ReturnPeriod;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Time-weighted return as basis points × 10⁴ (fraction × 10⁸). */
  readonly twrBpsE4: bigint;
  /** Modified Dietz on the same scale; null when nothing was invested. */
  readonly mwrBpsE4: bigint | null;
  readonly flowsCents: bigint;
  readonly version: number;
  readonly supersedesId: string | null;
  readonly reason: string | null;
  readonly computedAt: Date;
}

export interface PeriodReturnRepository {
  /** Highest version for (period, periodEnd), optionally as known at `publishedAt`. */
  latest(
    customerId: string,
    period: ReturnPeriod,
    periodEnd: string,
    publishedAt?: Date,
  ): Promise<PeriodReturnRecord | null>;
  /** Every version for (period, periodEnd), ascending by version. */
  versions(customerId: string, period: ReturnPeriod, periodEnd: string): Promise<readonly PeriodReturnRecord[]>;
  insert(record: Omit<PeriodReturnRecord, "computedAt">): Promise<PeriodReturnRecord>;
  /** Superseding versions across all customers, newest first — the restatement audit. */
  listRestated(limit: number): Promise<readonly PeriodReturnRecord[]>;
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
  findById(id: string): Promise<OrderRecord | null>;
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

export interface LotAdjustment {
  readonly id: string;
  readonly lotId: string;
  /** The ledger entry that moved the units (e.g. the split entry). */
  readonly entryId: string;
  readonly kind: "split";
  readonly ratioNumerator: bigint;
  readonly ratioDenominator: bigint;
  readonly unitsAfter: bigint;
  /** Decimal string; total basis is unchanged, so this is basis ÷ unitsAfter. */
  readonly basisPerUnitAfter: string;
  readonly effectiveAt: Date;
}

export interface RecordedLotConsumption extends LotConsumption {
  readonly id: string;
  /** The sell entry that consumed the units; one entry consumes many lots. */
  readonly sellEntryId: string;
  readonly consumedAt: Date;
}

export interface TaxLotRepository {
  open(lot: TaxLot): Promise<void>;
  /** Open lots net of consumptions, with any corporate-action adjustments applied. */
  availableLots(customerId: string, symbol: string): Promise<readonly LotAvailability[]>;
  adjust(adjustment: LotAdjustment): Promise<void>;
  consume(consumptions: readonly RecordedLotConsumption[]): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Settlement, custodian files, reconciliation (ADR-0005)               */
/* ------------------------------------------------------------------ */

export interface SettlementRecord {
  readonly id: string;
  readonly orderId: string;
  readonly fillExternalId: string;
  readonly side: "buy" | "sell";
  /** Cost of a buy or proceeds of a sell, always positive. */
  readonly amountCents: bigint;
  readonly tradeDate: string;
  readonly contractualSettlementDate: string;
  readonly status: "pending" | "settled";
  readonly journalEntryId: string | null;
}

export interface SettlementRepository {
  /** Idempotent on `fillExternalId`: a replayed fill records nothing new. */
  record(settlement: SettlementRecord): Promise<void>;
  listDue(onOrBefore: string): Promise<readonly SettlementRecord[]>;
  listPending(): Promise<readonly SettlementRecord[]>;
  markSettled(id: string, journalEntryId: string): Promise<void>;
}

export interface CustodianFileRecord {
  readonly id: string;
  readonly businessDate: string;
  readonly kind: "combined";
  readonly sha256: string;
  readonly storagePath: string;
  readonly content: string;
  readonly source: string;
  readonly receivedAt: Date;
}

export interface CustodianFileRepository {
  save(file: CustodianFileRecord): Promise<void>;
  findById(id: string): Promise<CustodianFileRecord | null>;
  /** The newest file for a business date on or before `businessDate`. */
  latestOnOrBefore(businessDate: string): Promise<CustodianFileRecord | null>;
}

export interface ReconRunRecord {
  readonly id: string;
  readonly businessDate: string;
  readonly fileId: string;
  readonly status: "running" | "completed" | "failed";
  readonly ledgerSnapshotHash: string;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
}

export type ReconBreakStatus = "open" | "explained" | "resolved";

export interface ReconBreakRecord extends ReconBreak {
  readonly id: string;
  readonly firstRunId: string;
  readonly lastSeenRunId: string;
  /** Business date of the first run that saw the break — the aging anchor. */
  readonly firstSeenBusinessDate: string;
  readonly brokerValue: bigint | null;
  readonly status: ReconBreakStatus;
  readonly resolutionEntryId: string | null;
  readonly resolutionNote: string | null;
  readonly resolvedByActorId: string | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
}

export interface ReconSighting extends ReconBreak {
  readonly brokerValue: bigint | null;
}

export interface ReconciliationRepository {
  createRun(run: ReconRunRecord): Promise<void>;
  finishRun(id: string, status: "completed" | "failed", finishedAt: Date): Promise<void>;
  listRuns(limit: number): Promise<readonly ReconRunRecord[]>;
  /**
   * Records what a run saw: a break already open for the same
   * (customer, category, key) gets `lastSeenRunId` and fresh values; anything
   * else opens a new break anchored to this run.
   */
  recordSightings(run: ReconRunRecord, sightings: readonly ReconSighting[]): Promise<{ opened: number; refreshed: number }>;
  listBreaks(filter: { status?: ReconBreakStatus; limit?: number }): Promise<readonly ReconBreakRecord[]>;
  findBreak(id: string): Promise<ReconBreakRecord | null>;
  closeBreak(input: {
    id: string;
    status: "explained" | "resolved";
    note: string;
    actorId: string;
    entryId: string | null;
    at: Date;
  }): Promise<void>;
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

export interface InboundEventRecord {
  readonly id: string;
  readonly provider: InboxEvent["provider"];
  readonly externalId: string;
  readonly dedupeKey: string;
  readonly type: string;
  readonly payload: unknown;
  readonly signatureValid: boolean;
  readonly receivedAt: Date;
  readonly attempts: readonly { readonly status: "processed" | "failed"; readonly error: string | null; readonly at: Date }[];
}

/** Operator view over the inbox: what arrived, whether it was applied, and replay. */
export interface InboundEventLog {
  list(limit: number): Promise<readonly InboundEventRecord[]>;
  findById(id: string): Promise<InboundEventRecord | null>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}
