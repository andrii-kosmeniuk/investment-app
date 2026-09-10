import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const database = drizzle(neon(url));
await migrate(database, { migrationsFolder: "./migrations" });
console.log("Database migrations applied.");
