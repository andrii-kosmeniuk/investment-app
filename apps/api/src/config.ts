import { z } from "zod";

const optionalSecret = z.string().min(1).optional();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  PLAID_BASE_URL: z.string().url().default("https://sandbox.plaid.com"),
  PLAID_CLIENT_ID: optionalSecret,
  PLAID_SECRET: optionalSecret,
  PERSONA_WEBHOOK_SECRET: optionalSecret,
  MCP_API_KEY: z.string().min(24),
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
