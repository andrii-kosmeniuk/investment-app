import type { Cents, MicroUnits } from "../money/index.js";
import { cents, divideHalfEven } from "../money/index.js";

/** micro-units (1e6) × price scaled to 1e8 → cents (1e2): divide by 1e12. */
const VALUE_DENOMINATOR = 1_000_000_000_000n;

/** Values micro-units against a USD price scaled to eight decimals. */
export function valuePosition(units: MicroUnits, priceE8: bigint): Cents {
  return cents(divideHalfEven(units * priceE8, VALUE_DENOMINATOR));
}

export interface PriceObservation {
  readonly symbol: string;
  readonly priceE8: bigint;
  readonly tradeDate: string;
  readonly staleDays: number;
}

export interface ValuedPosition {
  readonly symbol: string;
  readonly units: MicroUnits;
  readonly value: Cents;
  readonly priceStatus: "final" | "stale";
  readonly priceDate: string;
}

export function valuePositions(
  positions: readonly { symbol: string; units: MicroUnits }[],
  prices: ReadonlyMap<string, PriceObservation>,
): readonly ValuedPosition[] {
  return positions.map((position) => {
    const price = prices.get(position.symbol);
    if (!price) throw new Error(`No usable close for ${position.symbol}`);
    return {
      ...position,
      value: valuePosition(position.units, price.priceE8),
      priceStatus: price.staleDays === 0 ? "final" : "stale",
      priceDate: price.tradeDate,
    };
  });
}
