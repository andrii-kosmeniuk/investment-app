import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

export * from "./schema.js";
export * from "./pool.js";
export * from "./repositories/index.js";

export function createDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is required");
  return drizzle(neon(url), { schema });
}

export type Database = ReturnType<typeof createDatabase>;
