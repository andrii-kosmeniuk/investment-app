import type { CustomerRecord, CustomerRepository, KycStatus } from "@corgi/application";
import { eq } from "drizzle-orm";
import type { TransactionalDatabase } from "../pool.js";
import { customerPortfolios, customers } from "../schema.js";

/**
 * Customer profile + KYC gate. `brokerAccountId` is sourced from the customer's
 * portfolio (assigned when the Alpaca account is created), so trading can only
 * proceed once both KYC is approved and a broker account exists.
 */
export class DrizzleCustomerRepository implements CustomerRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async findById(id: string): Promise<CustomerRecord | null> {
    const [row] = await this.db
      .select({
        id: customers.id,
        kycStatus: customers.kycStatus,
        tradingBlocked: customers.tradingBlocked,
        brokerAccountId: customerPortfolios.brokerAccountId,
      })
      .from(customers)
      .leftJoin(customerPortfolios, eq(customerPortfolios.customerId, customers.id))
      .where(eq(customers.id, id))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      kycStatus: row.kycStatus as KycStatus,
      tradingBlocked: row.tradingBlocked,
      brokerAccountId: row.brokerAccountId ?? null,
    };
  }

  async setKycStatus(id: string, status: KycStatus, tradingBlocked: boolean): Promise<void> {
    await this.db
      .update(customers)
      .set({ kycStatus: status, tradingBlocked })
      .where(eq(customers.id, id));
  }
}
