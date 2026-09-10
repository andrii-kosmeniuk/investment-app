import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  PLAID_BASE_URL: z.string().url().default("https://sandbox.plaid.com"),
  PLAID_CLIENT_ID: z.string().min(1),
  PLAID_SECRET: z.string().min(1),
  PERSONA_WEBHOOK_SECRET: z.string().min(1),
  MCP_API_KEY: z.string().min(24),
});

export type ApiConfig = z.infer<typeof schema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  return schema.parse(environment);
}
