/**
 * Seed v1 — reference data and demo logins. Idempotent: safe to re-run.
 *
 * Seeds the four model portfolios, the ops/agent actors, and two demo customers
 * with sign-in credentials. It deliberately writes no ledger, transfer, or
 * price fixtures: every balance a reviewer sees is produced by the real rails
 * (Plaid sandbox deposits, Alpaca paper fills, the pricing worker), so an empty
 * portfolio on first sign-in is the honest state, not a missing seed.
 *
 * Demo password comes from SEED_DEMO_PASSWORD (default below); it is printed at
 * the end so the T+24 note can quote it.
 */
import { hashPassword } from "@corgi/application";
import {
  DrizzleCredentialsRepository,
  actors,
  createPool,
  createTransactionalDatabase,
  customers,
  modelAllocations,
  modelPortfolios,
} from "@corgi/database";
import { sql } from "drizzle-orm";

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "corgi-demo-2026";
const effectiveAt = new Date("2026-01-01T00:00:00Z");

interface ModelSeed {
  code: string;
  name: string;
  riskLevel: number;
  cashBufferBps: number;
  allocations: readonly { symbol: string; targetWeightBps: number }[];
}

// Three funds, four risk levels. Weights per model sum to exactly 10,000 bps —
// the database CHECK enforces it too, so a typo here fails loudly.
const MODELS: readonly ModelSeed[] = [
  {
    code: "conservative-income-v1",
    name: "Conservative income",
    riskLevel: 1,
    cashBufferBps: 100,
    allocations: [
      { symbol: "BND", targetWeightBps: 7000 },
      { symbol: "VTI", targetWeightBps: 2000 },
      { symbol: "VXUS", targetWeightBps: 1000 },
    ],
  },
  {
    code: "balanced-v1",
    name: "Balanced",
    riskLevel: 2,
    cashBufferBps: 100,
    allocations: [
      { symbol: "VTI", targetWeightBps: 4500 },
      { symbol: "VXUS", targetWeightBps: 1500 },
      { symbol: "BND", targetWeightBps: 4000 },
    ],
  },
  {
    code: "balanced-growth-v1",
    name: "Balanced growth",
    riskLevel: 3,
    cashBufferBps: 100,
    allocations: [
      { symbol: "VTI", targetWeightBps: 6000 },
      { symbol: "VXUS", targetWeightBps: 1900 },
      { symbol: "BND", targetWeightBps: 2100 },
    ],
  },
  {
    code: "growth-v1",
    name: "Growth",
    riskLevel: 5,
    cashBufferBps: 100,
    allocations: [
      { symbol: "VTI", targetWeightBps: 7000 },
      { symbol: "VXUS", targetWeightBps: 2500 },
      { symbol: "BND", targetWeightBps: 500 },
    ],
  },
];

const DEMO_CUSTOMERS = [
  { email: "olivia@demo.corgi", displayName: "Olivia Martin", kycStatus: "approved", tradingBlocked: false },
  { email: "noah@demo.corgi", displayName: "Noah Williams", kycStatus: "needs_review", tradingBlocked: true },
] as const;

for (const model of MODELS) {
  const total = model.allocations.reduce((sum, allocation) => sum + allocation.targetWeightBps, 0);
  if (total !== 10_000) throw new Error(`${model.code} weights sum to ${total}, expected 10000`);
}

const pool = createPool();
const database = createTransactionalDatabase(pool);

try {
  for (const model of MODELS) {
    const [row] = await database
      .insert(modelPortfolios)
      .values({
        code: model.code,
        name: model.name,
        riskLevel: model.riskLevel,
        cashBufferBps: model.cashBufferBps,
        version: 1,
        effectiveAt,
      })
      .onConflictDoUpdate({
        target: modelPortfolios.code,
        set: { name: model.name, riskLevel: model.riskLevel, cashBufferBps: model.cashBufferBps },
      })
      .returning({ id: modelPortfolios.id });
    if (!row) throw new Error(`Failed to upsert model ${model.code}`);

    await database
      .insert(modelAllocations)
      .values(model.allocations.map((allocation) => ({ modelId: row.id, ...allocation })))
      .onConflictDoUpdate({
        target: [modelAllocations.modelId, modelAllocations.symbol],
        set: { targetWeightBps: sql`excluded.target_weight_bps` },
      });
  }

  await database
    .insert(actors)
    .values([
      { email: "maker@demo.corgi", displayName: "Sam Chen", role: "ops", actorType: "human" },
      { email: "checker@demo.corgi", displayName: "Maya Brooks", role: "ops", actorType: "human" },
      { email: "agent@demo.corgi", displayName: "Portfolio Assistant", role: "agent", actorType: "agent" },
    ])
    .onConflictDoNothing({ target: actors.email });

  const credentials = new DrizzleCredentialsRepository(database);
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  for (const customer of DEMO_CUSTOMERS) {
    const [row] = await database
      .insert(customers)
      .values(customer)
      .onConflictDoUpdate({
        target: customers.email,
        set: { displayName: customer.displayName },
      })
      .returning({ id: customers.id });
    if (!row) throw new Error(`Failed to upsert customer ${customer.email}`);
    await credentials.setPasswordHash(row.id, passwordHash);
  }

  console.log(`Seeded ${MODELS.length} models, 3 actors, ${DEMO_CUSTOMERS.length} demo customers.`);
  console.log("Demo logins (password for both):", DEMO_PASSWORD);
  for (const customer of DEMO_CUSTOMERS) {
    console.log(`  ${customer.email}  (${customer.kycStatus})`);
  }
} finally {
  await pool.end();
}
