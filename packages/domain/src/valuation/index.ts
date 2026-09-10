import type { Cents, MicroUnits } from "../money/index.js";
import { cents } from "../money/index.js";

const VALUE_DENOMINATOR = 1_000_000_000_000n;

function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  const twice = absoluteRemainder * 2n;
  if (twice < denominator) return quotient;
  if (twice > denominator || quotient % 2n !== 0n) {
    return quotient + (numerator < 0n ? -1n : 1n);
  }
  return quotient;
}

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
