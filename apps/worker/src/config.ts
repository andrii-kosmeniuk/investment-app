import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
  ALPACA_BROKER_BASE_URL: z.string().url().default("https://broker-api.sandbox.alpaca.markets"),
  ALPACA_KEY: z.string().min(1),
  ALPACA_SECRET: z.string().min(1),
  ALPACA_MARKET_DATA_BASE_URL: z.string().url().default("https://data.sandbox.alpaca.markets"),
  /** Calendar days the nightly price/valuation jobs re-check (late feeds, missed runs). */
  VALUATION_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(60).default(7),
  // Plaid transfer-event sync is optional: when unset the worker still runs the
  // Alpaca stream and the inbox processor, it just won't poll for ACH events.
  PLAID_BASE_URL: z.string().url().default("https://sandbox.plaid.com"),
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),
  INBOX_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  INBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  PLAID_SYNC_MS: z.coerce.number().int().min(1_000).max(300_000).default(15_000),
  /**
   * Sandbox only: a Plaid transfer older than this is nudged pending → posted →
   * settled through `/sandbox/transfer/simulate`, because sandbox transfers
   * never move on their own (ADR-0008). Ignored against production Plaid.
   */
  PLAID_SANDBOX_SETTLE_MS: z.coerce.number().int().min(0).max(86_400_000).default(60_000),
  /** How often orders queued during a broker outage are re-sent (ADR-0007). */
  ORDER_RETRY_MS: z.coerce.number().int().min(5_000).max(600_000).default(30_000),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  return schema.parse(environment);
}
