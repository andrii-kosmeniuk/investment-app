import pino from "pino";
import { processInboxBatch } from "@corgi/application";
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
} from "@corgi/database";
import {
  AlpacaBrokerAdapter,
  AlpacaMarketDataAdapter,
  PlaidFundingAdapter,
  parsePlaidTransferEvent,
} from "@corgi/integrations";
import { eq } from "drizzle-orm";
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
const handlers = buildProviderHandlers({
  ledger: new DrizzleLedgerRepository(db),
  clock,
  ids,
  resolver: new DrizzleAccountResolver(db),
  orders: new DrizzleOrderRepository(db),
  taxLots: new DrizzleTaxLotRepository(db),
  transfers: new DrizzleTransferRepository(db),
  customers: new DrizzleCustomerRepository(db),
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
      for await (const event of broker.streamTradeEvents(state?.cursor ?? undefined)) {
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
    } catch (error) {
      reconnectAttempt += 1;
      const delayMs = Math.min(30_000, 500 * 2 ** reconnectAttempt);
      logger.error({ error, reconnectAttempt, delayMs }, "Alpaca stream disconnected");
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

function runLoop(label: string, task: () => Promise<void>, intervalMs: number): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running || shutdown.signal.aborted) return;
    running = true;
    task()
      .catch((error) => logger.error({ error, loop: label }, "loop iteration failed"))
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

async function stop(signal: string): Promise<void> {
  logger.info({ signal }, "worker shutting down");
  shutdown.abort();
  clearInterval(inboxTimer);
  if (plaidTimer) clearInterval(plaidTimer);
  for (const job of scheduled) job.stop();
  await pool.end();
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

await consumeAlpaca();
