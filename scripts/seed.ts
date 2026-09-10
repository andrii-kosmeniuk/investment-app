import {
  actors,
  createDatabase,
  customers,
  modelAllocations,
  modelPortfolios,
} from "@corgi/database";

const database = createDatabase();
const effectiveAt = new Date("2026-01-01T00:00:00Z");

const [model] = await database
  .insert(modelPortfolios)
  .values({
    code: "balanced-growth-v1",
    name: "Balanced growth",
    riskLevel: 3,
    cashBufferBps: 100,
    version: 1,
    effectiveAt,
  })
  .onConflictDoNothing({ target: modelPortfolios.code })
  .returning({ id: modelPortfolios.id });

if (model) {
  await database.insert(modelAllocations).values([
    { modelId: model.id, symbol: "VTI", targetWeightBps: 6000 },
    { modelId: model.id, symbol: "VXUS", targetWeightBps: 1800 },
    { modelId: model.id, symbol: "BND", targetWeightBps: 2100 },
  ]);
}

await database
  .insert(actors)
  .values([
    {
      email: "maker@demo.corgi",
      displayName: "Sam Chen",
      role: "ops",
      actorType: "human",
    },
    {
      email: "checker@demo.corgi",
      displayName: "Maya Brooks",
      role: "ops",
      actorType: "human",
    },
    {
      email: "agent@demo.corgi",
      displayName: "Portfolio Assistant",
      role: "agent",
      actorType: "agent",
    },
  ])
  .onConflictDoNothing({ target: actors.email });

await database
  .insert(customers)
  .values([
    {
      email: "olivia@demo.corgi",
      displayName: "Olivia Martin",
      kycStatus: "approved",
      tradingBlocked: false,
    },
    {
      email: "noah@demo.corgi",
      displayName: "Noah Williams",
      kycStatus: "needs_review",
      tradingBlocked: true,
    },
  ])
  .onConflictDoNothing({ target: customers.email });

console.log("Seeded model, two operators, one agent, and two customers.");
