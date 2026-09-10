import pino from "pino";
import { createDatabase, inboundEvents, providerStates } from "@corgi/database";
import { AlpacaBrokerAdapter } from "@corgi/integrations";
import { eq } from "drizzle-orm";
import { loadWorkerConfig } from "./config.js";
import { financialJobs, scheduleJobs } from "./jobs.js";

const config = loadWorkerConfig();
const logger = pino({ level: config.NODE_ENV === "production" ? "info" : "debug" });
const database = createDatabase(config.DATABASE_URL);
const broker = new AlpacaBrokerAdapter({
  baseUrl: config.ALPACA_BROKER_BASE_URL,
  key: config.ALPACA_KEY,
  secret: config.ALPACA_SECRET,
});
const shutdown = new AbortController();

const scheduled = scheduleJobs(
  financialJobs({
    async settleTrades() {
      logger.info("settlement handler boundary ready");
    },
    async collectClosingPrices() {
      logger.info("price collection handler boundary ready");
    },
    async valuePortfolios() {
      logger.info("valuation handler boundary ready");
    },
    async importCustodianFile() {
      logger.info("custodian import handler boundary ready");
    },
    async reconcileCustodian() {
      logger.info("reconciliation handler boundary ready");
    },
  }),
  logger,
  shutdown.signal,
);

async function consumeAlpaca(): Promise<void> {
  let reconnectAttempt = 0;
  while (!shutdown.signal.aborted) {
    try {
      const [state] = await database
        .select({ cursor: providerStates.cursor })
        .from(providerStates)
        .where(eq(providerStates.provider, "alpaca"))
        .limit(1);
      for await (const event of broker.streamTradeEvents(state?.cursor ?? undefined)) {
        if (shutdown.signal.aborted) break;
        await database
          .insert(inboundEvents)
          .values({
            provider: "alpaca",
            externalId: event.id,
            dedupeKey: `alpaca:trade:${event.id}`,
            eventType: event.type,
            payload: event.payload,
            signatureValid: true,
          })
          .onConflictDoNothing({ target: inboundEvents.dedupeKey });
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

async function stop(signal: string): Promise<void> {
  logger.info({ signal }, "worker shutting down");
  shutdown.abort();
  for (const job of scheduled) job.stop();
}

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

await consumeAlpaca();
