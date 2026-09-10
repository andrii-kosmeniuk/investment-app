const MONEY_SCALE = 2;
const UNIT_SCALE = 6;
const TEN = 10n;

export type Cents = bigint & { readonly __brand: "Cents" };
export type MicroUnits = bigint & { readonly __brand: "MicroUnits" };
export type BasisPoints = number & { readonly __brand: "BasisPoints" };

export const cents = (value: bigint): Cents => value as Cents;
export const microUnits = (value: bigint): MicroUnits => value as MicroUnits;
export const basisPoints = (value: number): BasisPoints => {
  if (!Number.isInteger(value)) throw new TypeError("Basis points must be an integer");
  return value as BasisPoints;
};

/**
 * Parses an exact decimal using bankers' (half-even) rounding.
 * Number inputs are intentionally prohibited at financial boundaries.
 */
export function parseDecimal(value: string, scale: number): bigint {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new TypeError(`Invalid decimal: ${value}`);

  const negative = match[1] === "-";
  const whole = match[2] ?? "0";
  const fraction = match[3] ?? "";
  const kept = fraction.slice(0, scale).padEnd(scale, "0");
  const discarded = fraction.slice(scale);
  let result = BigInt(whole) * TEN ** BigInt(scale) + BigInt(kept || "0");

  if (discarded.length > 0) {
    const first = Number(discarded[0]);
    const remaining = discarded.slice(1);
    const roundUp =
      first > 5 ||
      (first === 5 && (/[1-9]/.test(remaining) || result % 2n !== 0n));
    if (roundUp) result += 1n;
  }

  return negative ? -result : result;
}

/** Inverse of `parseDecimal`: renders a scaled integer as an exact decimal string. */
export function formatDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale === 0 ? "" : `.${digits.slice(digits.length - scale)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** Integer division with bankers' (half-even) rounding, sign-symmetric. */
export function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero");
  if (denominator < 0n) return divideHalfEven(-numerator, -denominator);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = (remainder < 0n ? -remainder : remainder) * 2n;
  if (twice < denominator) return quotient;
  if (twice > denominator || quotient % 2n !== 0n) return quotient + (numerator < 0n ? -1n : 1n);
  return quotient;
}

export const parseUsd = (value: string): Cents => cents(parseDecimal(value, MONEY_SCALE));
export const parseUnits = (value: string): MicroUnits =>
  microUnits(parseDecimal(value, UNIT_SCALE));

export interface AllocationInput {
  readonly key: string;
  readonly weight: bigint;
}

/** Hamilton largest-remainder allocation with stable key tie-breaking. */
export function allocateLargestRemainder(
  total: bigint,
  inputs: readonly AllocationInput[],
): ReadonlyMap<string, bigint> {
  if (total < 0n) throw new RangeError("Allocation total cannot be negative");
  const denominator = inputs.reduce((sum, item) => sum + item.weight, 0n);
  if (denominator <= 0n) throw new RangeError("Weights must sum above zero");

  const rows = inputs.map((item) => {
    if (item.weight < 0n) throw new RangeError("Weight cannot be negative");
    const numerator = total * item.weight;
    return {
      key: item.key,
      allocated: numerator / denominator,
      remainder: numerator % denominator,
    };
  });
  let left = total - rows.reduce((sum, row) => sum + row.allocated, 0n);
  rows.sort((a, b) =>
    a.remainder === b.remainder
      ? a.key.localeCompare(b.key)
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const row of rows) {
    if (left === 0n) break;
    row.allocated += 1n;
    left -= 1n;
  }
  return new Map(rows.map((row) => [row.key, row.allocated]));
}
