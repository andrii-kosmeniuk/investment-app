import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema.js";

// The read path (createDatabase in ./index.ts) uses Neon's stateless HTTP
// driver — cheap and perfect for server components and MCP reads. The write
// path needs interactive transactions (BEGIN … advisory lock … COMMIT) to seal
// the hash chain atomically, which requires the WebSocket-backed Pool. Node 22
// ships a global WebSocket; wire it in so the Pool can connect.
const globalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
const configurable = neonConfig as { webSocketConstructor?: unknown };
if (!configurable.webSocketConstructor && globalWebSocket) {
  configurable.webSocketConstructor = globalWebSocket;
}

/**
 * Interactive transactions (advisory lock + deferred balance check) need a
 * real Postgres session. Neon's pooled host is PgBouncer in transaction mode
 * and cannot hold that session, so the write path prefers the direct URL.
 */
export function writeConnectionUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const url = env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required");
  return url;
}

export function createPool(url = writeConnectionUrl()): Pool {
  return new Pool({ connectionString: url });
}

/**
 * Transactional Drizzle client for the write path. Callers should reuse a
 * single instance (it manages a connection pool) and close it on shutdown.
 */
export function createTransactionalDatabase(pool: Pool = createPool()) {
  return drizzle(pool, { schema });
}

export type TransactionalDatabase = ReturnType<typeof createTransactionalDatabase>;
