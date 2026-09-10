import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  ALPACA_BROKER_BASE_URL: z.string().url().default("https://broker-api.sandbox.alpaca.markets"),
  ALPACA_KEY: z.string().min(1),
  ALPACA_SECRET: z.string().min(1),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(5),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  return schema.parse(environment);
}
