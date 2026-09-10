import { z } from "zod";

const optionalSecret = z.string().min(1).optional();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  /** Shown in the shell as the environment badge; never inferred from NODE_ENV. */
  ENVIRONMENT_NAME: z.enum(["sandbox", "production"]).default("sandbox"),
  DATABASE_URL: z.string().min(1),
  /** Direct (non-pooled) Neon host for the customer write path; falls back to DATABASE_URL. */
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
  /** HMAC key for customer session tokens. Rotating it signs everyone out. */
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 14).default(12),
  /** Single orders at/above this notional need a second-actor approval. */
  ORDER_CONFIRMATION_THRESHOLD_CENTS: z.coerce.bigint().positive().default(100_000n),
  MAXIMUM_DEPOSIT_CENTS: z.coerce.bigint().positive().default(5_000_000n),
  PLAID_BASE_URL: z.string().url().default("https://sandbox.plaid.com"),
  PLAID_CLIENT_ID: optionalSecret,
  PLAID_SECRET: optionalSecret,
  PERSONA_BASE_URL: z.string().url().default("https://api.withpersona.com"),
  PERSONA_API_KEY: optionalSecret,
  PERSONA_TEMPLATE_ID: optionalSecret,
  PERSONA_WEBHOOK_SECRET: optionalSecret,
  ALPACA_BROKER_BASE_URL: z.string().url().default("https://broker-api.sandbox.alpaca.markets"),
  ALPACA_KEY: optionalSecret,
  ALPACA_SECRET: optionalSecret,
  ALPACA_MARKET_DATA_BASE_URL: z.string().url().default("https://data.sandbox.alpaca.markets"),
  MCP_API_KEY: z.string().min(24),
  /** Operator token for the live-fire console and restatement audit; unset → those routes answer 503. */
  LIVE_FIRE_TOKEN: z.string().min(24).optional(),
});

export type ApiConfig = z.infer<typeof schema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const result = schema.safeParse(environment);
  if (result.success) return result.data;
  const missing = result.error.issues
    .map((issue) => issue.path.join(".") || "environment")
    .join(", ");
  throw new Error(`Missing or invalid environment variables: ${missing}`);
}
