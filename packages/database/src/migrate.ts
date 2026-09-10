import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { writeConnectionUrl } from "./pool.js";

const url = writeConnectionUrl();
const database = drizzle(neon(url));
await migrate(database, { migrationsFolder: "./migrations" });
console.log("Database migrations applied.");
