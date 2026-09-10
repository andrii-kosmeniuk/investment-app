import { eq } from "drizzle-orm";
import type { TransactionalDatabase } from "../pool.js";
import { transfers } from "../schema.js";

export interface TransferRecord {
  readonly customerId: string;
  readonly amountCents: bigint;
}

/**
 * Looks up the customer and amount behind a Plaid transfer. Plaid transfer
 * events carry only the transfer id, so the ledger amount is sourced from the
 * transfer we recorded at creation time.
 */
export class DrizzleTransferRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async findByProviderId(providerTransferId: string): Promise<TransferRecord | null> {
    const [row] = await this.db
      .select({ customerId: transfers.customerId, amountCents: transfers.amountCents })
      .from(transfers)
      .where(eq(transfers.providerTransferId, providerTransferId))
      .limit(1);
    return row ? { customerId: row.customerId, amountCents: row.amountCents } : null;
  }
}
