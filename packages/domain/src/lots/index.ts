import type { Cents, MicroUnits } from "../money/index.js";
import { cents, microUnits } from "../money/index.js";

export interface TaxLot {
  readonly id: string;
  readonly customerId: string;
  readonly symbol: string;
  readonly openedEntryId: string;
  readonly openedAt: Date;
  readonly units: MicroUnits;
  readonly basis: Cents;
}

export interface LotConsumption {
  readonly lotId: string;
  readonly units: MicroUnits;
  readonly basis: Cents;
  readonly proceeds: Cents;
  readonly realizedGain: Cents;
  readonly term: "short" | "long";
}

export interface LotAvailability {
  readonly lot: TaxLot;
  readonly remainingUnits: MicroUnits;
  readonly remainingBasis: Cents;
}

export function consumeFifo(
  availableLots: readonly LotAvailability[],
  unitsToSell: MicroUnits,
  totalProceeds: Cents,
  soldAt: Date,
): readonly LotConsumption[] {
  let remaining = unitsToSell;
  const ordered = [...availableLots].sort(
    (a, b) => a.lot.openedAt.getTime() - b.lot.openedAt.getTime(),
  );
  const results: LotConsumption[] = [];

  for (const available of ordered) {
    if (remaining === 0n) break;
    if (available.remainingUnits <= 0n) continue;
    const units =
      available.remainingUnits < remaining ? available.remainingUnits : remaining;
    const basis = cents(
      (available.remainingBasis * units) / available.remainingUnits,
    );
    const proceeds = cents((totalProceeds * units) / unitsToSell);
    const holdingDays = Math.floor(
      (soldAt.getTime() - available.lot.openedAt.getTime()) / 86_400_000,
    );
    results.push({
      lotId: available.lot.id,
      units: microUnits(units),
      basis,
      proceeds,
      realizedGain: cents(proceeds - basis),
      term: holdingDays > 365 ? "long" : "short",
    });
    remaining = microUnits(remaining - units);
  }

  if (remaining !== 0n) throw new RangeError("Insufficient lot units for sale");
  return results;
}

export function applySplit(
  lot: LotAvailability,
  numerator: bigint,
  denominator: bigint,
): LotAvailability {
  if (numerator <= 0n || denominator <= 0n) throw new RangeError("Invalid split ratio");
  return {
    lot: {
      ...lot.lot,
      units: microUnits((lot.lot.units * numerator) / denominator),
    },
    remainingUnits: microUnits((lot.remainingUnits * numerator) / denominator),
    remainingBasis: lot.remainingBasis,
  };
}
