import { createDatabase, createPool, createTransactionalDatabase } from "@corgi/database";
import { buildApi } from "./app.js";
import { loadConfig } from "./config.js";
import { createCustomerServices } from "./customer/composition.js";
import { createServices } from "./services.js";

const config = loadConfig();
// Reads for health/MCP go over Neon HTTP; the customer surface writes (transfers,
// bank links, orders) and reads the ledger, so it uses the session-capable pool.
const database = createDatabase(config.DATABASE_URL);
const pool = createPool(config.DATABASE_URL_UNPOOLED ?? config.DATABASE_URL);
const customer = createCustomerServices(createTransactionalDatabase(pool), config);
const app = await buildApi(config, createServices(database, customer));

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await pool.end();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
