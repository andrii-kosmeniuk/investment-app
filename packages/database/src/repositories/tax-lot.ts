import type { LotAdjustment, TaxLotRepository } from "@corgi/application";
import { type LotAvailability, type TaxLot, cents, microUnits } from "@corgi/domain";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { TransactionalDatabase } from "../pool.js";
import { lotAdjustments, lotConsumptions, taxLots } from "../schema.js";

/**
 * FIFO tax lots. `availableLots` returns each open lot net of the units and
 * basis already consumed by sells, with corporate-action adjustments applied:
 * a split rewrites the lot's unit count (basis unchanged) and scales any
 * consumption that happened before it, so post-split arithmetic is all in
 * post-split units. Nothing here is updated in place — lots, consumptions and
 * adjustments are append-only rows and the remaining quantity is derived.
 */
export class DrizzleTaxLotRepository implements TaxLotRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async open(lot: TaxLot): Promise<void> {
    await this.db.insert(taxLots).values({
      id: lot.id,
      customerId: lot.customerId,
      symbol: lot.symbol,
      openedEntryId: lot.openedEntryId,
      openedAt: lot.openedAt,
      unitsMicro: lot.units,
      basisCents: lot.basis,
      method: "fifo",
    });
  }

  async adjust(adjustment: LotAdjustment): Promise<void> {
    await this.db.insert(lotAdjustments).values({
      id: adjustment.id,
      lotId: adjustment.lotId,
      entryId: adjustment.entryId,
      kind: adjustment.kind,
      ratioNumerator: adjustment.ratioNumerator,
      ratioDenominator: adjustment.ratioDenominator,
      unitsAfter: adjustment.unitsAfter,
      basisPerUnitAfter: adjustment.basisPerUnitAfter,
      effectiveAt: adjustment.effectiveAt,
    });
  }

  async availableLots(customerId: string, symbol: string): Promise<readonly LotAvailability[]> {
    const lots = await this.db
      .select()
      .from(taxLots)
      .where(and(eq(taxLots.customerId, customerId), eq(taxLots.symbol, symbol)))
      .orderBy(asc(taxLots.openedAt));
    if (lots.length === 0) return [];
    const lotIds = lots.map((lot) => lot.id);

    const [consumptions, adjustments] = await Promise.all([
      this.db.select().from(lotConsumptions).where(inArray(lotConsumptions.lotId, lotIds)),
      this.db.select().from(lotAdjustments).where(inArray(lotAdjustments.lotId, lotIds)).orderBy(asc(lotAdjustments.effectiveAt)),
    ]);

    return lots
      .map((row) => {
        const lotAdjustmentsAsc = adjustments.filter((a) => a.lotId === row.id);
        // Scale each consumption by every adjustment that came after it.
        const consumedUnits = consumptions
          .filter((c) => c.lotId === row.id)
          .reduce((sum, c) => {
            const later = lotAdjustmentsAsc.filter((a) => a.effectiveAt > c.consumedAt);
            return sum + later.reduce((units, a) => (units * a.ratioNumerator) / a.ratioDenominator, c.unitsMicro);
          }, 0n);
        const consumedBasis = consumptions.filter((c) => c.lotId === row.id).reduce((sum, c) => sum + c.basisCents, 0n);
        const totalUnits = lotAdjustmentsAsc.reduce((units, a) => (units * a.ratioNumerator) / a.ratioDenominator, row.unitsMicro);

        const lot: TaxLot = {
          id: row.id,
          customerId: row.customerId,
          symbol: row.symbol,
          openedEntryId: row.openedEntryId,
          openedAt: row.openedAt,
          units: microUnits(totalUnits),
          basis: cents(row.basisCents),
        };
        return {
          lot,
          remainingUnits: microUnits(totalUnits - consumedUnits),
          remainingBasis: cents(row.basisCents - consumedBasis),
        } satisfies LotAvailability;
      })
      .filter((availability) => availability.remainingUnits > 0n);
  }
}
