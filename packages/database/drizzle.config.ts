import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  // Generation is offline; this placeholder is never contacted. Runtime and
  // migration execution still fail closed when DATABASE_URL is absent.
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://generation-only:generation-only@localhost/generation-only",
  },
  strict: true,
  verbose: true,
});
