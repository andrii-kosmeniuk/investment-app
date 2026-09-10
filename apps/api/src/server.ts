import { createDatabase } from "@corgi/database";
import { buildApi } from "./app.js";
import { loadConfig } from "./config.js";
import { createServices } from "./services.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const app = await buildApi(config, createServices(database));

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.HOST, port: config.PORT });
