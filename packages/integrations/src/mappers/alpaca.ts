import type { FillEvent } from "@corgi/application";
import { parseDecimal, parseUnits } from "@corgi/domain";
import { z } from "zod";

const numeric = z.union([z.string(), z.number()]);

const tradeSchema = z.object({
  event: z.string(),
  execution_id: z.string().optional(),
  id: numeric.optional(),
  timestamp: z.string().optional(),
  price: numeric.optional(),
  order: z.object({
    id: z.string(),
    symbol: z.string(),
    filled_qty: numeric.optional(),
  }),
});

/**
 * Maps an Alpaca trade-update SSE payload to a normalized fill. Returns null for
 * any event other than `fill`/`partial_fill`, or when the payload is missing the
 * price/quantity needed to book a lot — the caller then treats it as unhandled.
 */
export function parseAlpacaFillEvent(payload: unknown): FillEvent | null {
  const parsed = tradeSchema.safeParse(payload);
  if (!parsed.success) return null;
  const { event, order, price, timestamp } = parsed.data;
  if (event !== "fill" && event !== "partial_fill") return null;
  if (price === undefined || order.filled_qty === undefined) return null;

  const executionId = String(parsed.data.execution_id ?? parsed.data.id ?? "");
  if (!executionId) return null;

  return {
    executionId,
    providerOrderId: order.id,
    symbol: order.symbol,
    cumulativeUnitsMicro: parseUnits(String(order.filled_qty)),
    priceE8: parseDecimal(String(price), 8),
    occurredAt: timestamp ? new Date(timestamp) : new Date(),
    terminal: event === "fill",
  };
}
