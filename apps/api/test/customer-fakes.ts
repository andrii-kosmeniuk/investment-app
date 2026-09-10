import type {
  AppendResult,
  ApprovalRepository,
  BankAccountRecord,
  BrokerPort,
  BrokerPosition,
  CustomerProfile,
  CustomerRecord,
  DailyClose,
  FundingPort,
  IdentityInquiryRecord,
  IdentityPort,
  KycStatus,
  LotAdjustment,
  ModelDefinition,
  OpenOrder,
  OrderRecord,
  PortfolioAssignment,
  ProviderEvent,
  TransferRecord,
} from "@corgi/application";
import { hashPassword } from "@corgi/application";
import {
  InMemoryPeriodReturnRepository,
  InMemoryPriceRepository,
  InMemoryValuationRepository,
} from "@corgi/application/testing";
import {
  type AppendableEntry,
  type ApprovalRequest,
  type ClearingAccounts,
  type CustomerLedgerAccounts,
  type JournalEntry,
  type TaxLot,
  microUnits,
  sealNext,
} from "@corgi/domain";
import { createSessionTokens } from "../src/auth/session.js";
import type { ApiConfig } from "../src/config.js";
import type { CustomerServices } from "../src/customer/services.js";

export const OLIVIA_ID = "6f1c9a1e-1b2c-4d3e-8f90-1234567890ab";
export const NOAH_ID = "7a2d8b2f-2c3d-4e4f-9a01-234567890abc";
export const MODEL_ID = "8b3e9c3a-3d4e-4f50-ab12-34567890abcd";
export const BANK_ID = "9c4fad4b-4e5f-4061-bc23-4567890abcde";

export const SESSION_SECRET = "test-session-secret-that-is-at-least-32-chars";
export const LIVE_FIRE_TOKEN = "test-live-fire-operator-token-0001";

export const testConfig: ApiConfig = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 0,
  WEB_ORIGIN: "http://localhost:3000",
  ENVIRONMENT_NAME: "sandbox",
  DATABASE_URL: "postgres://unused",
  SESSION_SECRET,
  SESSION_TTL_HOURS: 1,
  ORDER_CONFIRMATION_THRESHOLD_CENTS: 100_000n,
  MAXIMUM_DEPOSIT_CENTS: 5_000_000n,
  PLAID_BASE_URL: "https://sandbox.plaid.com",
  PERSONA_BASE_URL: "https://api.withpersona.com",
  ALPACA_BROKER_BASE_URL: "https://broker-api.sandbox.alpaca.markets",
  ALPACA_MARKET_DATA_BASE_URL: "https://data.sandbox.alpaca.markets",
  MCP_API_KEY: "mcp-test-key-that-is-long-enough-123",
  LIVE_FIRE_TOKEN,
};

export interface FakeState {
  /** Mutable clock so tests can move past a publication cut-off. */
  now: Date;
  profiles: CustomerProfile[];
  passwordHashes: Record<string, string>;
  inquiries: IdentityInquiryRecord[];
  bankAccounts: BankAccountRecord[];
  transfers: TransferRecord[];
  entries: JournalEntry[];
  prices: InMemoryPriceRepository;
  valuations: InMemoryValuationRepository;
  returns: InMemoryPeriodReturnRepository;
  lots: TaxLot[];
  adjustments: LotAdjustment[];
  /** What the fake market-data feed returns for any window. */
  marketCloses: DailyClose[];
  models: ModelDefinition[];
  assignments: Map<string, PortfolioAssignment>;
  openOrders: OpenOrder[];
  approvals: ApprovalRequest[];
  submittedOrders: Array<{ symbol: string; notionalCents: bigint }>;
  deposits: Array<{ accessToken: string; amountCents: bigint }>;
  identityCalls: string[];
}

function accountsFor(customerId: string): CustomerLedgerAccounts {
  const prefix = `customer:${customerId}`;
  return {
    settledCash: `${prefix}:cash:settled`,
    pendingDeposit: `${prefix}:cash:pending`,
    unsettledBuys: `${prefix}:cash:unsettled-buys`,
    unsettledSells: `${prefix}:cash:unsettled-sells`,
    dividendReceivable: `${prefix}:receivable:dividend`,
    bounceRecovery: `${prefix}:receivable:bounce`,
    dividendIncome: `${prefix}:income:dividend`,
    feeExpense: `${prefix}:expense:fee`,
    position: (symbol) => `${prefix}:position:${symbol}`,
  };
}

const clearing: ClearingAccounts = {
  plaidSweep: "firm:clearing:plaid-sweep",
  tradingUsd: "firm:clearing:trading-usd",
  rounding: "firm:clearing:rounding",
  tradingUnits: (symbol) => `firm:clearing:trading-units:${symbol}`,
  custodianStreet: (symbol) => `firm:custodian:street:${symbol}`,
};

/** Seeds a settled $1,000 deposit and a VTI buy for Olivia using real posting shapes. */
export function oliviaEntries(): JournalEntry[] {
  const accounts = accountsFor(OLIVIA_ID);
  let tip: string | null = null;
  const entries: JournalEntry[] = [];
  const append = (entry: AppendableEntry) => {
    const sealed = sealNext(tip, entry);
    tip = sealed.hash;
    entries.push(sealed);
  };
  append({
    id: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "plaid:transfer.pending:xfer-1",
    kind: "deposit_pending",
    effectiveAt: new Date("2026-09-08T14:00:00Z"),
    postedAt: new Date("2026-09-08T14:00:01Z"),
    source: "plaid",
    sourceRef: "xfer-1",
    description: "ACH debit initiated",
    postings: [
      { accountId: accounts.pendingDeposit, commodity: "USD", quantity: 100_000n },
      { accountId: clearing.plaidSweep, commodity: "USD", quantity: -100_000n },
    ],
  });
  append({
    id: "22222222-2222-4222-8222-222222222222",
    idempotencyKey: "plaid:transfer.settled:xfer-1",
    kind: "deposit_settled",
    effectiveAt: new Date("2026-09-09T14:00:00Z"),
    postedAt: new Date("2026-09-09T14:00:01Z"),
    source: "plaid",
    sourceRef: "xfer-1",
    description: "Deposit settled to cash",
    postings: [
      { accountId: accounts.settledCash, commodity: "USD", quantity: 100_000n },
      { accountId: accounts.pendingDeposit, commodity: "USD", quantity: -100_000n },
    ],
  });
  append({
    id: "33333333-3333-4333-8333-333333333333",
    idempotencyKey: "alpaca:fill:exec-1",
    kind: "buy_fill",
    effectiveAt: new Date("2026-09-09T15:30:00Z"),
    postedAt: new Date("2026-09-09T15:30:02Z"),
    source: "alpaca",
    sourceRef: "exec-1",
    description: "Buy VTI",
    postings: [
      { accountId: accounts.position("VTI"), commodity: "VTI", quantity: 2_000_000n, lotId: "lot-1" },
      { accountId: clearing.tradingUnits("VTI"), commodity: "VTI", quantity: -2_000_000n },
      { accountId: accounts.unsettledBuys, commodity: "USD", quantity: -59_400n },
      { accountId: clearing.tradingUsd, commodity: "USD", quantity: 59_400n },
    ],
  });
  return entries;
}

export async function defaultState(): Promise<FakeState> {
  const clock = { now: () => state.now };
  const prices = new InMemoryPriceRepository();
  await prices.record([{ symbol: "VTI", tradeDate: "2026-09-10", price: "297.005", source: "test" }], new Date("2026-09-10T20:15:00Z"));
  const state: FakeState = {
    now: new Date("2026-09-10T15:00:00Z"),
    profiles: [
      { id: OLIVIA_ID, email: "olivia@demo.corgi", displayName: "Olivia Martin", kycStatus: "approved", tradingBlocked: false },
      { id: NOAH_ID, email: "noah@demo.corgi", displayName: "Noah Williams", kycStatus: "needs_review", tradingBlocked: true },
    ],
    passwordHashes: { [OLIVIA_ID]: await hashPassword("corgi-demo-2026"), [NOAH_ID]: await hashPassword("corgi-demo-2026") },
    inquiries: [],
    bankAccounts: [
      {
        id: BANK_ID,
        customerId: OLIVIA_ID,
        providerAccountId: "plaid-acct-1",
        providerAccessToken: "access-sandbox-1",
        institutionName: "Chase",
        accountMask: "4821",
        status: "active",
        createdAt: new Date("2026-09-07T12:00:00Z"),
      },
    ],
    transfers: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        customerId: OLIVIA_ID,
        bankAccountId: BANK_ID,
        providerTransferId: "xfer-1",
        direction: "deposit",
        amountCents: 100_000n,
        status: "pending",
        returnCode: null,
        createdAt: new Date("2026-09-08T13:00:00Z"),
      },
    ],
    entries: oliviaEntries(),
    prices,
    valuations: new InMemoryValuationRepository(clock),
    returns: new InMemoryPeriodReturnRepository(clock),
    lots: [
      {
        id: "lot-1",
        customerId: OLIVIA_ID,
        symbol: "VTI",
        openedEntryId: "33333333-3333-4333-8333-333333333333",
        openedAt: new Date("2026-09-09T15:30:00Z"),
        units: microUnits(2_000_000n),
        basis: 59_400n as TaxLot["basis"],
      },
    ],
    adjustments: [],
    marketCloses: [],
    models: [
      {
        id: MODEL_ID,
        code: "balanced-growth-v1",
        name: "Balanced growth",
        riskLevel: 3,
        cashBufferBps: 100,
        allocations: [
          { symbol: "VTI", targetWeightBps: 6000, minimumTradeCents: 100n, fractionalAllowed: true },
          { symbol: "VXUS", targetWeightBps: 1900, minimumTradeCents: 100n, fractionalAllowed: true },
          { symbol: "BND", targetWeightBps: 2100, minimumTradeCents: 100n, fractionalAllowed: true },
        ],
      },
    ],
    assignments: new Map([[OLIVIA_ID, { customerId: OLIVIA_ID, modelId: MODEL_ID, brokerAccountId: "alpaca-acct-1", status: "open" }]]),
    openOrders: [],
    approvals: [],
    submittedOrders: [],
    deposits: [],
    identityCalls: [],
  };
  return state;
}

export interface FakeOptions {
  readonly withIdentity?: boolean;
  readonly withFunding?: boolean;
  readonly withBroker?: boolean;
  readonly withMarketData?: boolean;
  /** `null` simulates an environment without LIVE_FIRE_TOKEN. */
  readonly liveFireToken?: string | null;
}

export function fakeCustomerServices(state: FakeState, options: FakeOptions = {}): CustomerServices {
  const identity: IdentityPort = {
    createInquiry: (customerId) => {
      state.identityCalls.push(customerId);
      return Promise.resolve({ inquiryId: `inq-${state.identityCalls.length}`, sessionToken: "tok-1" });
    },
    resumeInquiry: () => Promise.resolve({ sessionToken: "tok-resumed" }),
    getStatus: () => Promise.resolve("pending"),
  };
  const funding: FundingPort = {
    createLinkToken: () => Promise.resolve("link-sandbox-abc"),
    exchangePublicToken: (publicToken) => Promise.resolve({ accessToken: `access-${publicToken}`, itemId: "item-1" }),
    createDeposit: (input) => {
      state.deposits.push({ accessToken: input.accessToken, amountCents: input.amountCents });
      return Promise.resolve({ transferId: `xfer-${state.deposits.length + 1}`, status: "pending" });
    },
    syncEvents: () => Promise.resolve({ events: [] as readonly ProviderEvent[], nextCursor: "0" }),
  };
  const broker: BrokerPort = {
    createAccount: (customerId) => Promise.resolve({ accountId: `alpaca-${customerId}`, status: "ACTIVE" }),
    submitNotionalOrder: (input) => {
      state.submittedOrders.push({ symbol: input.symbol, notionalCents: input.notionalCents });
      return Promise.resolve({ providerOrderId: `prov-${state.submittedOrders.length}`, status: "submitted" });
    },
    getPositions: () => Promise.resolve([] as readonly BrokerPosition[]),
    async *streamTradeEvents() {
      // none
    },
  };
  const approvals: ApprovalRepository = {
    create: (request) => {
      state.approvals.push(request);
      return Promise.resolve();
    },
    listPending: () => Promise.resolve(state.approvals),
  };
  let counter = 0;

  return {
    sessions: createSessionTokens({ secret: SESSION_SECRET, ttlSeconds: 3600 }),
    clock: { now: () => state.now },
    ids: { next: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}` },
    environment: "sandbox",
    limits: { orderConfirmationThresholdCents: 100_000n, maximumDepositCents: 5_000_000n },
    directory: {
      findProfile: (id) => Promise.resolve(state.profiles.find((profile) => profile.id === id) ?? null),
      findProfileByEmail: (email) => Promise.resolve(state.profiles.find((profile) => profile.email === email) ?? null),
    },
    credentials: { findPasswordHash: (id) => Promise.resolve(state.passwordHashes[id] ?? null) },
    customers: {
      findById: (id): Promise<CustomerRecord | null> => {
        const profile = state.profiles.find((candidate) => candidate.id === id);
        if (!profile) return Promise.resolve(null);
        return Promise.resolve({
          id,
          kycStatus: profile.kycStatus,
          tradingBlocked: profile.tradingBlocked,
          brokerAccountId: state.assignments.get(id)?.brokerAccountId ?? null,
        });
      },
      setKycStatus: (id, status: KycStatus, tradingBlocked) => {
        state.profiles = state.profiles.map((profile) => (profile.id === id ? { ...profile, kycStatus: status, tradingBlocked } : profile));
        return Promise.resolve();
      },
    },
    inquiries: {
      latestForCustomer: (id) => Promise.resolve(state.inquiries.filter((inquiry) => inquiry.customerId === id).at(-1) ?? null),
      create: (record) => {
        state.inquiries.push(record);
        return Promise.resolve();
      },
    },
    bankAccounts: {
      listForCustomer: (id) => Promise.resolve(state.bankAccounts.filter((bank) => bank.customerId === id)),
      findById: (id) => Promise.resolve(state.bankAccounts.find((bank) => bank.id === id) ?? null),
      create: (record) => {
        state.bankAccounts.push(record);
        return Promise.resolve();
      },
    },
    transfers: {
      create: (record) => {
        state.transfers.push(record);
        return Promise.resolve();
      },
      listForCustomer: (id) => Promise.resolve(state.transfers.filter((transfer) => transfer.customerId === id)),
      findByProviderId: () => Promise.resolve(null),
    },
    ledger: {
      // Real append semantics over the shared entry list: dedupe on key, seal onto the tip.
      append: (entry): Promise<AppendResult> => {
        const existing = state.entries.find((candidate) => candidate.idempotencyKey === entry.idempotencyKey);
        if (existing) return Promise.resolve({ status: "duplicate", entry: existing });
        const sealed = sealNext(state.entries.at(-1)?.hash ?? null, entry);
        state.entries.push(sealed);
        return Promise.resolve({ status: "inserted", entry: sealed });
      },
      findByIdempotencyKey: (key) => Promise.resolve(state.entries.find((entry) => entry.idempotencyKey === key) ?? null),
      listForCustomer: (customerId, cutoff) =>
        Promise.resolve(
          state.entries.filter(
            (entry) =>
              entry.postings.some((posting) => posting.accountId.startsWith(`customer:${customerId}:`)) &&
              entry.effectiveAt <= cutoff.effectiveAt &&
              entry.postedAt <= cutoff.publishedAt,
          ),
        ),
    },
    resolver: {
      forCustomer: (customerId) => Promise.resolve(accountsFor(customerId)),
      clearing: () => Promise.resolve(clearing),
    },
    accounts: {
      // Account ids double as paths in this fake, so the map is the identity.
      pathsById: (ids) => Promise.resolve(new Map(ids.map((id) => [id, id]))),
      positionSymbols: (customerId) =>
        Promise.resolve(
          [
            ...new Set(
              state.entries.flatMap((entry) =>
                entry.postings
                  .filter((posting) => posting.accountId.startsWith(`customer:${customerId}:position:`))
                  .map((posting) => posting.commodity),
              ),
            ),
          ].sort(),
        ),
      allPositionSymbols: () =>
        Promise.resolve(
          [...new Set(state.entries.flatMap((entry) => entry.postings.filter((p) => p.accountId.includes(":position:")).map((p) => p.commodity)))].sort(),
        ),
      customersWithAccounts: () => Promise.resolve(state.profiles.map((profile) => profile.id)),
      customersHolding: (symbol) =>
        Promise.resolve(
          state.profiles
            .map((profile) => profile.id)
            .filter((id) => state.entries.some((entry) => entry.postings.some((p) => p.accountId === `customer:${id}:position:${symbol}`))),
        ),
    },
    prices: state.prices,
    valuations: state.valuations,
    returns: state.returns,
    taxLots: {
      open: (lot) => {
        state.lots.push(lot);
        return Promise.resolve();
      },
      availableLots: (customerId, symbol) =>
        Promise.resolve(
          state.lots
            .filter((lot) => lot.customerId === customerId && lot.symbol === symbol)
            .map((lot) => {
              const adjusted = state.adjustments.filter((a) => a.lotId === lot.id).at(-1);
              const units = adjusted ? microUnits(adjusted.unitsAfter) : lot.units;
              return { lot: { ...lot, units }, remainingUnits: units, remainingBasis: lot.basis };
            }),
        ),
      adjust: (adjustment) => {
        state.adjustments.push(adjustment);
        return Promise.resolve();
      },
    },
    models: {
      list: () => Promise.resolve(state.models),
      findByCode: (code) => Promise.resolve(state.models.find((model) => model.code === code) ?? null),
      findById: (id) => Promise.resolve(state.models.find((model) => model.id === id) ?? null),
    },
    portfolios: {
      findForCustomer: (id) => Promise.resolve(state.assignments.get(id) ?? null),
      assign: (assignment) => {
        state.assignments.set(assignment.customerId, assignment);
        return Promise.resolve();
      },
    },
    orders: {
      create: () => Promise.resolve(),
      findByClientOrderId: (): Promise<OrderRecord | null> => Promise.resolve(null),
      findByProviderOrderId: (): Promise<OrderRecord | null> => Promise.resolve(null),
      recordFill: () => Promise.resolve(),
    },
    orderListing: { listOpenForCustomer: () => Promise.resolve(state.openOrders) },
    approvals,
    identity: options.withIdentity === false ? null : identity,
    funding: options.withFunding === false ? null : funding,
    broker: options.withBroker === false ? null : broker,
    marketData: options.withMarketData === false ? null : { getDailyCloses: () => Promise.resolve(state.marketCloses) },
    liveFireToken: options.liveFireToken === undefined ? LIVE_FIRE_TOKEN : options.liveFireToken,
  };
}
