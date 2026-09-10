import type { OrderRecord, OrderRepository } from "@corgi/application";
import type { OrderState } from "@corgi/domain";
import { eq } from "drizzle-orm";
import type { TransactionalDatabase } from "../pool.js";
import { orderEvents, orders } from "../schema.js";

type OrderRow = typeof orders.$inferSelect;

function toRecord(row: OrderRow): OrderRecord {
  return {
    id: row.id,
    customerId: row.customerId,
    clientOrderId: row.clientOrderId,
    providerOrderId: row.providerOrderId,
    symbol: row.symbol,
    side: row.side as "buy" | "sell",
    state: row.state as OrderState,
    cumulativeFilledUnitsMicro: row.cumulativeFilledUnitsMicro,
  };
}

/** JSON-safe copy of a payload that may contain bigints (jsonb cannot hold them). */
function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, val) => (typeof val === "bigint" ? val.toString() : val)),
  );
}

export class DrizzleOrderRepository implements OrderRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async create(order: {
    id: string;
    customerId: string;
    clientOrderId: string;
    providerOrderId: string | null;
    symbol: string;
    side: "buy" | "sell";
    state: OrderState;
    requestedNotionalCents: bigint;
  }): Promise<void> {
    await this.db.insert(orders).values({
      id: order.id,
      customerId: order.customerId,
      clientOrderId: order.clientOrderId,
      providerOrderId: order.providerOrderId,
      symbol: order.symbol,
      side: order.side,
      requestedNotionalCents: order.requestedNotionalCents,
      state: order.state,
    });
  }

  async findByClientOrderId(clientOrderId: string): Promise<OrderRecord | null> {
    const [row] = await this.db
      .select()
      .from(orders)
      .where(eq(orders.clientOrderId, clientOrderId))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async findByProviderOrderId(providerOrderId: string): Promise<OrderRecord | null> {
    const [row] = await this.db
      .select()
      .from(orders)
      .where(eq(orders.providerOrderId, providerOrderId))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async recordFill(input: {
    orderId: string;
    externalId: string;
    state: OrderState;
    cumulativeFilledUnitsMicro: bigint;
    payload: unknown;
    occurredAt: Date;
  }): Promise<void> {
    await this.db
      .insert(orderEvents)
      .values({
        orderId: input.orderId,
        externalId: input.externalId,
        type: input.state,
        payload: jsonSafe(input.payload),
        occurredAt: input.occurredAt,
      })
      .onConflictDoNothing({ target: orderEvents.externalId });

    await this.db
      .update(orders)
      .set({
        state: input.state,
        cumulativeFilledUnitsMicro: input.cumulativeFilledUnitsMicro,
      })
      .where(eq(orders.id, input.orderId));
  }
}
