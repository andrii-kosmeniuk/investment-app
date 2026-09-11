import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const actorType = pgEnum("actor_type", ["human", "agent"]);
export const approvalStatus = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);
export const eventProvider = pgEnum("event_provider", [
  "alpaca",
  "plaid",
  "persona",
  "custodian",
]);

export const customers = pgTable("customers", {
  id: id(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  kycStatus: text("kyc_status").notNull().default("not_started"),
  tradingBlocked: boolean("trading_blocked").notNull().default(true),
  createdAt: createdAt(),
});

/**
 * Sign-in credentials live apart from the profile so a customer row can exist
 * (seeded, imported, or created by ops) before it can sign in, and so profile
 * reads never touch the hash. One password per customer for this build.
 */
export const customerCredentials = pgTable("customer_credentials", {
  customerId: uuid("customer_id")
    .primaryKey()
    .references(() => customers.id),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const actors = pgTable("actors", {
  id: id(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull(),
  actorType: actorType("actor_type").notNull().default("human"),
  createdAt: createdAt(),
});

export const identityInquiries = pgTable(
  "identity_inquiries",
  {
    id: id(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    provider: text("provider").notNull(),
    providerInquiryId: text("provider_inquiry_id").notNull(),
    status: text("status").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("identity_inquiries_provider_uq").on(table.providerInquiryId)],
);

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: id(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    providerAccountId: text("provider_account_id").notNull(),
    // Plaid item credential needed for Transfer calls. Sandbox-only storage;
    // production must encrypt at rest or move to a secrets vault (ADR-0003).
    providerAccessToken: text("provider_access_token").notNull(),
    institutionName: text("institution_name").notNull(),
    accountMask: text("account_mask").notNull(),
    status: text("status").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("bank_accounts_provider_uq").on(table.providerAccountId)],
);

export const transfers = pgTable(
  "transfers",
  {
    id: id(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id),
    providerTransferId: text("provider_transfer_id").notNull(),
    direction: text("direction").notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    status: text("status").notNull(),
    returnCode: text("return_code"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("transfers_provider_uq").on(table.providerTransferId)],
);

export const modelPortfolios = pgTable("model_portfolios", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  riskLevel: integer("risk_level").notNull(),
  cashBufferBps: integer("cash_buffer_bps").notNull().default(100),
  version: integer("version").notNull().default(1),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const modelAllocations = pgTable(
  "model_allocations",
  {
    id: id(),
    modelId: uuid("model_id").notNull().references(() => modelPortfolios.id),
    symbol: text("symbol").notNull(),
    targetWeightBps: integer("target_weight_bps").notNull(),
    minimumTradeCents: bigint("minimum_trade_cents", { mode: "bigint" })
      .notNull()
      .default(sql`100`),
    fractionalAllowed: boolean("fractional_allowed").notNull().default(true),
  },
  (table) => [
    uniqueIndex("model_allocations_symbol_uq").on(table.modelId, table.symbol),
    check(
      "model_allocations_weight_range",
      sql`${table.targetWeightBps} >= 0 AND ${table.targetWeightBps} <= 10000`,
    ),
  ],
);

export const customerPortfolios = pgTable(
  "customer_portfolios",
  {
    id: id(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    modelId: uuid("model_id").notNull().references(() => modelPortfolios.id),
    brokerAccountId: text("broker_account_id").notNull(),
    status: text("status").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("customer_portfolios_customer_uq").on(table.customerId)],
);

export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: id(),
    customerId: uuid("customer_id").references(() => customers.id),
    path: text("path").notNull(),
    kind: text("kind").notNull(),
    commodityConstraint: text("commodity_constraint"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("ledger_accounts_path_uq").on(table.path)],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: id(),
    idempotencyKey: text("idempotency_key").notNull(),
    kind: text("kind").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull(),
    sourceRef: text("source_ref").notNull(),
    reversesEntryId: uuid("reverses_entry_id"),
    description: text("description").notNull(),
    previousHash: text("previous_hash"),
    hash: text("hash").notNull(),
  },
  (table) => [
    uniqueIndex("journal_entries_idempotency_uq").on(table.idempotencyKey),
    index("journal_entries_bitemporal_idx").on(table.effectiveAt, table.postedAt),
  ],
);

export const postings = pgTable(
  "postings",
  {
    id: id(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => ledgerAccounts.id),
    commodity: text("commodity").notNull(),
    quantity: bigint("quantity", { mode: "bigint" }).notNull(),
    lotId: uuid("lot_id"),
  },
  (table) => [
    index("postings_entry_idx").on(table.entryId),
    index("postings_account_commodity_idx").on(table.accountId, table.commodity),
  ],
);

export const inboundEvents = pgTable(
  "inbound_events",
  {
    id: id(),
    provider: eventProvider("provider").notNull(),
    externalId: text("external_id").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("inbound_events_dedupe_uq").on(table.dedupeKey),
    index("inbound_events_received_idx").on(table.receivedAt),
  ],
);

export const inboundEventAttempts = pgTable(
  "inbound_event_attempts",
  {
    id: id(),
    eventId: uuid("event_id").notNull().references(() => inboundEvents.id),
    attempt: integer("attempt").notNull(),
    status: text("status").notNull(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("inbound_event_attempts_number_uq").on(table.eventId, table.attempt),
    index("inbound_event_attempts_status_idx").on(table.status, table.startedAt),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    providerOrderId: text("provider_order_id"),
    clientOrderId: text("client_order_id").notNull(),
    symbol: text("symbol").notNull(),
    side: text("side").notNull(),
    requestedNotionalCents: bigint("requested_notional_cents", { mode: "bigint" }),
    requestedUnitsMicro: bigint("requested_units_micro", { mode: "bigint" }),
    cumulativeFilledUnitsMicro: bigint("cumulative_filled_units_micro", {
      mode: "bigint",
    })
      .notNull()
      .default(sql`0`),
    state: text("state").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("orders_client_order_uq").on(table.clientOrderId),
    uniqueIndex("orders_provider_order_uq").on(table.providerOrderId),
  ],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    externalId: text("external_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: createdAt(),
  },
  (table) => [uniqueIndex("order_events_external_uq").on(table.externalId)],
);

export const settlements = pgTable(
  "settlements",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    fillExternalId: text("fill_external_id").notNull(),
    tradeDate: date("trade_date").notNull(),
    contractualSettlementDate: date("contractual_settlement_date").notNull(),
    status: text("status").notNull(),
    /** Signed cash the settlement moves: cost of a buy, proceeds of a sell. */
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull().default(sql`0`),
    side: text("side").notNull().default("buy"),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("settlements_fill_uq").on(table.fillExternalId),
    index("settlements_due_idx").on(table.status, table.contractualSettlementDate),
  ],
);

export const rebalanceProposals = pgTable("rebalance_proposals", {
  id: id(),
  portfolioId: uuid("portfolio_id").notNull().references(() => customerPortfolios.id),
  modelId: uuid("model_id").notNull().references(() => modelPortfolios.id),
  status: text("status").notNull(),
  totalNotionalCents: bigint("total_notional_cents", { mode: "bigint" }).notNull(),
  generatedByActorId: uuid("generated_by_actor_id").notNull().references(() => actors.id),
  generatedByActorType: actorType("generated_by_actor_type").notNull(),
  asOfDate: date("as_of_date").notNull(),
  createdAt: createdAt(),
});

export const rebalanceLegs = pgTable("rebalance_legs", {
  id: id(),
  proposalId: uuid("proposal_id").notNull().references(() => rebalanceProposals.id),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  notionalCents: bigint("notional_cents", { mode: "bigint" }).notNull(),
  targetWeightBps: integer("target_weight_bps").notNull(),
  currentWeightBps: integer("current_weight_bps").notNull(),
  orderId: uuid("order_id").references(() => orders.id),
  createdAt: createdAt(),
});

export const taxLots = pgTable("tax_lots", {
  id: id(),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  symbol: text("symbol").notNull(),
  openedEntryId: uuid("opened_entry_id").notNull().references(() => journalEntries.id),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  unitsMicro: bigint("units_micro", { mode: "bigint" }).notNull(),
  basisCents: bigint("basis_cents", { mode: "bigint" }).notNull(),
  method: text("method").notNull().default("fifo"),
});

export const lotConsumptions = pgTable("lot_consumptions", {
  id: id(),
  lotId: uuid("lot_id").notNull().references(() => taxLots.id),
  sellEntryId: uuid("sell_entry_id").notNull().references(() => journalEntries.id),
  unitsMicro: bigint("units_micro", { mode: "bigint" }).notNull(),
  proceedsCents: bigint("proceeds_cents", { mode: "bigint" }).notNull(),
  basisCents: bigint("basis_cents", { mode: "bigint" }).notNull(),
  realizedCents: bigint("realized_cents", { mode: "bigint" }).notNull(),
  term: text("term").notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull(),
});

export const lotAdjustments = pgTable("lot_adjustments", {
  id: id(),
  lotId: uuid("lot_id").notNull().references(() => taxLots.id),
  entryId: uuid("entry_id").notNull().references(() => journalEntries.id),
  kind: text("kind").notNull(),
  ratioNumerator: bigint("ratio_numerator", { mode: "bigint" }).notNull(),
  ratioDenominator: bigint("ratio_denominator", { mode: "bigint" }).notNull(),
  unitsAfter: bigint("units_after", { mode: "bigint" }).notNull(),
  basisPerUnitAfter: numeric("basis_per_unit_after", { precision: 28, scale: 12 }).notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
});

export const prices = pgTable(
  "prices",
  {
    id: id(),
    symbol: text("symbol").notNull(),
    tradeDate: date("trade_date").notNull(),
    close: numeric("close", { precision: 20, scale: 8 }).notNull(),
    source: text("source").notNull(),
    version: integer("version").notNull(),
    supersedesId: uuid("supersedes_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull(),
  },
  (table) => [uniqueIndex("prices_symbol_date_version_uq").on(table.symbol, table.tradeDate, table.version)],
);

export const valuations = pgTable(
  "valuations",
  {
    id: id(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    asOfDate: date("as_of_date").notNull(),
    valueCents: bigint("value_cents", { mode: "bigint" }).notNull(),
    cashCents: bigint("cash_cents", { mode: "bigint" }).notNull(),
    positions: jsonb("positions").notNull(),
    priceSetHash: text("price_set_hash").notNull(),
    /** final | provisional (a held position was priced with a stale close). */
    status: text("status").notNull().default("final"),
    version: integer("version").notNull(),
    supersedesId: uuid("supersedes_id"),
    reason: text("reason"),
    computedAt: createdAt(),
  },
  (table) => [
    uniqueIndex("valuations_customer_date_version_uq").on(
      table.customerId,
      table.asOfDate,
      table.version,
    ),
  ],
);

export const periodReturns = pgTable(
  "period_returns",
  {
    id: id(),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    /** mtd | ytd | inception — part of the identity, since two periods can share start and end. */
    period: text("period").notNull().default("inception"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    twrBpsE4: bigint("twr_bps_e4", { mode: "bigint" }).notNull(),
    mwrBpsE4: bigint("mwr_bps_e4", { mode: "bigint" }),
    flowsCents: bigint("flows_cents", { mode: "bigint" }).notNull(),
    version: integer("version").notNull(),
    supersedesId: uuid("supersedes_id"),
    reason: text("reason"),
    computedAt: createdAt(),
  },
  (table) => [
    uniqueIndex("period_returns_version_uq").on(table.customerId, table.period, table.periodEnd, table.version),
    index("period_returns_customer_end_idx").on(table.customerId, table.periodEnd),
  ],
);

export const approvalRequests = pgTable("approval_requests", {
  id: id(),
  kind: text("kind").notNull(),
  amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
  payload: jsonb("payload").notNull(),
  requestedByActorId: uuid("requested_by_actor_id").notNull().references(() => actors.id),
  requestedByActorType: actorType("requested_by_actor_type").notNull(),
  status: approvalStatus("status").notNull().default("pending"),
  createdAt: createdAt(),
});

export const approvalDecisions = pgTable(
  "approval_decisions",
  {
    id: id(),
    requestId: uuid("request_id").notNull().references(() => approvalRequests.id),
    decidedByActorId: uuid("decided_by_actor_id").notNull().references(() => actors.id),
    decidedByActorType: actorType("decided_by_actor_type").notNull(),
    decision: text("decision").notNull(),
    reason: text("reason").notNull(),
    decidedAt: createdAt(),
  },
  (table) => [
    check("approval_decisions_human_only", sql`${table.decidedByActorType} = 'human'`),
  ],
);

export const custodianFiles = pgTable("custodian_files", {
  id: id(),
  businessDate: date("business_date").notNull(),
  kind: text("kind").notNull(),
  sha256: text("sha256").notNull(),
  storagePath: text("storage_path").notNull(),
  /** The file itself (CSV). Files are kilobytes; a blob store is not worth a provider (ADR-0005). */
  content: text("content").notNull().default(""),
  source: text("source").notNull().default("simulator"),
  receivedAt: createdAt(),
});

export const reconRuns = pgTable("recon_runs", {
  id: id(),
  businessDate: date("business_date").notNull(),
  fileId: uuid("file_id").notNull().references(() => custodianFiles.id),
  status: text("status").notNull(),
  ledgerSnapshotHash: text("ledger_snapshot_hash").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const reconBreaks = pgTable(
  "recon_breaks",
  {
    id: id(),
    firstRunId: uuid("first_run_id").notNull().references(() => reconRuns.id),
    lastSeenRunId: uuid("last_seen_run_id").notNull().references(() => reconRuns.id),
    customerId: uuid("customer_id").notNull().references(() => customers.id),
    category: text("category").notNull(),
    key: text("key").notNull(),
    ledgerValue: text("ledger_value").notNull(),
    custodianValue: text("custodian_value").notNull(),
    delta: text("delta").notNull(),
    /** Third column: the broker API's view when it was reachable (ADR-0005). */
    brokerValue: text("broker_value"),
    status: text("status").notNull().default("open"),
    resolutionEntryId: uuid("resolution_entry_id").references(() => journalEntries.id),
    resolutionNote: text("resolution_note"),
    resolvedByActorId: uuid("resolved_by_actor_id").references(() => actors.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index("recon_breaks_status_age_idx").on(table.status, table.createdAt),
    // One live break per identity; a resolved break that reappears is a new break with a new first run.
    uniqueIndex("recon_breaks_open_identity_uq")
      .on(table.customerId, table.category, table.key)
      .where(sql`${table.status} = 'open'`),
  ],
);

export const providerStates = pgTable("provider_states", {
  provider: text("provider").primaryKey(),
  status: text("status").notNull(),
  failureCount: integer("failure_count").notNull().default(0),
  cursor: text("cursor"),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  circuitOpenUntil: timestamp("circuit_open_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
