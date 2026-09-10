import type { TaxLotRepository } from "@corgi/application";
import { type LotAvailability, type TaxLot, cents, microUnits } from "@corgi/domain";
import { and, eq, sql } from "drizzle-orm";
import type { TransactionalDatabase } from "../pool.js";
import { lotConsumptions, taxLots } from "../schema.js";

/**
 * FIFO tax lots. `availableLots` returns each open lot net of the units and
 * basis already consumed by sells, so the FIFO matcher never over-allocates.
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

  async availableLots(customerId: string, symbol: string): Promise<readonly LotAvailability[]> {
    const rows = await this.db
      .select({
        id: taxLots.id,
        customerId: taxLots.customerId,
        symbol: taxLots.symbol,
        openedEntryId: taxLots.openedEntryId,
        openedAt: taxLots.openedAt,
        unitsMicro: taxLots.unitsMicro,
        basisCents: taxLots.basisCents,
        consumedUnits: sql<string>`coalesce(sum(${lotConsumptions.unitsMicro}), 0)`,
        consumedBasis: sql<string>`coalesce(sum(${lotConsumptions.basisCents}), 0)`,
      })
      .from(taxLots)
      .leftJoin(lotConsumptions, eq(lotConsumptions.lotId, taxLots.id))
      .where(and(eq(taxLots.customerId, customerId), eq(taxLots.symbol, symbol)))
      .groupBy(taxLots.id)
      .orderBy(taxLots.openedAt);

    return rows
      .map((row) => {
        const remainingUnits = row.unitsMicro - BigInt(row.consumedUnits);
        const remainingBasis = row.basisCents - BigInt(row.consumedBasis);
        const lot: TaxLot = {
          id: row.id,
          customerId: row.customerId,
          symbol: row.symbol,
          openedEntryId: row.openedEntryId,
          openedAt: row.openedAt,
          units: microUnits(row.unitsMicro),
          basis: cents(row.basisCents),
        };
        return {
          lot,
          remainingUnits: microUnits(remainingUnits),
          remainingBasis: cents(remainingBasis),
        } satisfies LotAvailability;
      })
      .filter((availability) => availability.remainingUnits > 0n);
  }
}
