import pino from "pino";
import { processInboxBatch, submitQueuedOrders } from "@corgi/application";
import {
  DrizzleAccountResolver,
  DrizzleActorDirectory,
  DrizzleApprovalRepository,
  DrizzleCustomerRepository,
  DrizzleInboxRepository,
  DrizzleLedgerAccountDirectory,
  DrizzleLedgerRepository,
  DrizzleOrderRepository,
  DrizzlePriceRepository,
  DrizzleSettlementRepository,
  DrizzleTaxLotRepository,
  DrizzleTransferRepository,
  createPool,
  createTransactionalDatabase,
  inboundEvents,
  providerStates,
  transfers,
} from "@corgi/database";
import {
  AlpacaBrokerAdapter,
  AlpacaMarketDataAdapter,
  PlaidFundingAdapter,
  parsePlaidTransferEvent,
} from "@corgi/integrations";
import { and, eq, gte, lte } from "drizzle-orm";
import { buildProviderHandlers, canonicalAlpacaType } from "./composition.js";
import { loadWorkerConfig } from "./config.js";
import { financialJobs, scheduleJobs } from "./jobs.js";
import { operationsJobs } from "./operations-jobs.js";
import { valuationJobs } from "./valuation-jobs.js";

const config = loadWorkerConfig();
const logger = pino({ level: config.NODE_ENV === "production" ? "info" : "debug" });
const shutdown = new AbortController();

const pool = createPool(config.DATABASE_URL_UNPOOLED ?? config.DATABASE_URL);
const db = createTransactionalDatabase(pool);

const broker = new AlpacaBrokerAdapter({
  baseUrl: config.ALPACA_BROKER_BASE_URL,
  key: config.ALPACA_KEY,
  secret: config.ALPACA_SECRET,
});
const funding =
  config.PLAID_CLIENT_ID && config.PLAID_SECRET
    ? new PlaidFundingAdapter({
        baseUrl: config.PLAID_BASE_URL,
        clientId: config.PLAID_CLIENT_ID,
        secret: config.PLAID_SECRET,
      })
    : null;

const clock = { now: () => new Date() };
const ids = { next: () => crypto.randomUUID() };
const inbox = new DrizzleInboxRepository(db);
const orders = new DrizzleOrderRepository(db);
const customers = new DrizzleCustomerRepository(db);
const handlers = buildProviderHandlers({
  ledger: new DrizzleLedgerRepository(db),
  clock,
  ids,
  resolver: new DrizzleAccountResolver(db),
  orders,
  taxLots: new DrizzleTaxLotRepository(db),
  transfers: new DrizzleTransferRepository(db),
  customers,
  settlements: new DrizzleSettlementRepository(db),
  approvals: new DrizzleApprovalRepository(db),
  actors: new DrizzleActorDirectory(db),
  accounts: new DrizzleLedgerAccountDirectory(db),
  prices: new DrizzlePriceRepository(db),
});

async function saveCursor(provider: string, cursor: string): Promise<void> {
  await db
    .insert(providerStates)
    .values({ provider, status: "streaming", cursor })
    .onConflictDoUpdate({
      target: providerStates.provider,
      set: { cursor, status: "streaming", updatedAt: new Date() },
    });
}

const valuation = valuationJobs({
  db,
  clock,
  ids,
  logger,
  lookbackDays: config.VALUATION_LOOKBACK_DAYS,
  marketData: new AlpacaMarketDataAdapter({
    baseUrl: config.ALPACA_MARKET_DATA_BASE_URL,
    key: config.ALPACA_KEY,
    secret: config.ALPACA_SECRET,
  }),
});

const operations = operationsJobs({ db, broker, clock, ids, logger });

const scheduled = scheduleJobs(
  financialJobs({
    settleTrades: operations.settleTrades,
    collectClosingPrices: valuation.collectClosingPrices,
    valuePortfolios: valuation.valuePortfolios,
    importCustodianFile: operations.importCustodianFile,
    reconcileCustodian: operations.reconcileCustodian,
  }),
  logger,
  shutdown.signal,
);

// The Alpaca broker publishes fills over SSE (not webhooks), so a long-running
// consumer is required. Events are normalized and parked in the inbox; the
// processor applies them. A capped exponential backoff survives disconnects.
async function consumeAlpaca(): Promise<void> {
  let reconnectAttempt = 0;
  while (!shutdown.signal.aborted) {
    try {
      const [state] = await db
        .select({ cursor: providerStates.cursor })
        .from(providerStates)
        .where(eq(providerStates.provider, "alpaca"))
        .limit(1);
      for await (const event of broker.streamTradeEvents(state?.cursor ?? undefined, shutdown.signal)) {
        if (shutdown.signal.aborted) break;
        const rawEvent = String((event.payload as { event?: unknown }).event ?? event.type);
        const canonical = canonicalAlpacaType(rawEvent);
        if (canonical) {
          await db
            .insert(inboundEvents)
            .values({
              provider: "alpaca",
              externalId: event.id,
              dedupeKey: `alpaca:trade:${event.id}`,
              eventType: canonical,
              payload: event.payload,
              signatureValid: true,
            })
            .onConflictDoNothing({ target: inboundEvents.dedupeKey });
        }
        if (event.cursor) await saveCursor("alpaca", event.cursor);
      }
      reconnectAttempt = 0;
    } catch (err) {
      if (shutdown.signal.aborted) break; // the stream was closed by stop(), not by Alpaca
      reconnectAttempt += 1;
      const delayMs = Math.min(30_000, 500 * 2 ** reconnectAttempt);
      // `err` is the key pino serialises (message + stack); `error` logs as {}.
      logger.error({ err, reconnectAttempt, delayMs }, "Alpaca stream disconnected");
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

// Plaid transfer state is authoritative via /transfer/event/sync (webhooks are
// only nudges). We normalize each event and enqueue it; the transfer amount is
// resolved from our own records when the event is processed.
async function syncPlaid(): Promise<void> {
  if (!funding) return;
  const [state] = await db
    .select({ cursor: providerStates.cursor })
    .from(providerStates)
    .where(eq(providerStates.provider, "plaid"))
    .limit(1);
  const { events, nextCursor } = await funding.syncEvents(state?.cursor ?? undefined);
  for (const event of events) {
    const note = parsePlaidTransferEvent(event.payload);
    if (!note) continue;
    await db
      .insert(inboundEvents)
      .values({
        provider: "plaid",
        externalId: event.id,
        dedupeKey: `plaid:event:${event.id}`,
        eventType: `transfer.${note.kind}`,
        payload: event.payload,
        signatureValid: true,
      })
      .onConflictDoNothing({ target: inboundEvents.dedupeKey });
  }
  if (nextCursor) await saveCursor("plaid", nextCursor);
}

// Plaid's sandbox never moves a transfer past `pending` on its own (only the
// dashboard, the magic amounts like $11.11, or /sandbox/transfer/simulate do).
// Stand in for the bank: once a deposit has aged PLAID_SANDBOX_SETTLE_MS, ask
// Plaid to post and settle it. The resulting events arrive through the same
// /transfer/event/sync path as production, so nothing here touches the ledger.
const SANDBOX_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
async function advanceSandboxTransfers(): Promise<void> {
  if (!funding?.isSandbox) return;
  const now = Date.now();
  const candidates = await db
    .select({ providerTransferId: transfers.providerTransferId, amountCents: transfers.amountCents })
    .from(transfers)
    .where(
      and(
        eq(transfers.direction, "deposit"),
        gte(transfers.createdAt, new Date(now - SANDBOX_LOOKBACK_MS)),
        lte(transfers.createdAt, new Date(now - config.PLAID_SANDBOX_SETTLE_MS)),
      ),
    );
  for (const transfer of candidates) {
    const status = await funding.getTransferStatus(transfer.providerTransferId);
    logger.debug({ transferId: transfer.providerTransferId, status }, "sandbox deposit checked");
    if (status !== "pending" && status !== "posted") continue; // settled, returned, failed: nothing to do
    if (status === "pending") await funding.simulateTransferEvent(transfer.providerTransferId, "posted");
    await funding.simulateTransferEvent(transfer.providerTransferId, "settled");
    logger.info({ transferId: transfer.providerTransferId, amountCents: transfer.amountCents.toString(), from: status }, "sandbox deposit settled");
  }
}

function runLoop(label: string, task: () => Promise<void>, intervalMs: number): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running || shutdown.signal.aborted) return;
    running = true;
    task()
      .catch((err) => logger.error({ err, loop: label }, "loop iteration failed"))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
}

const inboxTimer = runLoop(
  "inbox",
  () =>
    processInboxBatch({ inbox, handlers }, config.INBOX_BATCH_SIZE).then((result) => {
      if (result.leased > 0) logger.info(result, "inbox batch processed");
    }),
  config.INBOX_POLL_MS,
);
const plaidTimer = funding ? runLoop("plaid-sync", syncPlaid, config.PLAID_SYNC_MS) : null;
const sandboxSettleTimer = funding?.isSandbox ? runLoop("plaid-sandbox-settle", advanceSandboxTransfers, config.PLAID_SYNC_MS) : null;
// Orders placed while the broker answered 5xx / timed out sit as `approved`
// with no provider id; re-send them until the rail is back (ADR-0007).
const orderRetryTimer = runLoop(
  "order-retry",
  () =>
    submitQueuedOrders({ orders, customers, broker }).then((result) => {
      if (result.attempted > 0) logger.info(result, "queued orders re-sent");
    }),
  config.ORDER_RETRY_MS,
);

async function stop(signal: string): Promise<void> {
  logger.info({ signal }, "worker shutting down");
  shutdown.abort();
  clearInterval(inboxTimer);
  clearInterval(orderRetryTimer);
  if (plaidTimer) clearInterval(plaidTimer);
  if (sandboxSettleTimer) clearInterval(sandboxSettleTimer);
  for (const job of scheduled) job.stop();
  // Whatever is still awaiting (a loop mid-iteration, a slow pool.end) gets
  // ten seconds; Render's grace period is longer, so this is the fallback.
  setTimeout(() => process.exit(0), 10_000).unref();
  await pool.end();
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

await consumeAlpaca();
