import type {
  CredentialsRepository,
  CustomerDirectory,
  CustomerProfile,
  IdentityInquiryRecord,
  IdentityInquiryRepository,
  KycStatus,
} from "@corgi/application";
import { desc, eq } from "drizzle-orm";
import type { TransactionalDatabase } from "../pool.js";
import { customerCredentials, customers, identityInquiries } from "../schema.js";

type CustomerRow = typeof customers.$inferSelect;

function toProfile(row: CustomerRow): CustomerProfile {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    kycStatus: row.kycStatus as KycStatus,
    tradingBlocked: row.tradingBlocked,
  };
}

/** Profile reads for the signed-in surface; never selects credentials. */
export class DrizzleCustomerDirectory implements CustomerDirectory {
  constructor(private readonly db: TransactionalDatabase) {}

  async findProfile(id: string): Promise<CustomerProfile | null> {
    const [row] = await this.db.select().from(customers).where(eq(customers.id, id)).limit(1);
    return row ? toProfile(row) : null;
  }

  async findProfileByEmail(email: string): Promise<CustomerProfile | null> {
    const [row] = await this.db
      .select()
      .from(customers)
      .where(eq(customers.email, email.trim().toLowerCase()))
      .limit(1);
    return row ? toProfile(row) : null;
  }
}

export class DrizzleCredentialsRepository implements CredentialsRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async findPasswordHash(customerId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ passwordHash: customerCredentials.passwordHash })
      .from(customerCredentials)
      .where(eq(customerCredentials.customerId, customerId))
      .limit(1);
    return row?.passwordHash ?? null;
  }

  /** Used by seeding and password resets; replaces any previous hash. */
  async setPasswordHash(customerId: string, passwordHash: string): Promise<void> {
    await this.db
      .insert(customerCredentials)
      .values({ customerId, passwordHash })
      .onConflictDoUpdate({
        target: customerCredentials.customerId,
        set: { passwordHash, updatedAt: new Date() },
      });
  }
}

export class DrizzleIdentityInquiryRepository implements IdentityInquiryRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async latestForCustomer(customerId: string): Promise<IdentityInquiryRecord | null> {
    const [row] = await this.db
      .select()
      .from(identityInquiries)
      .where(eq(identityInquiries.customerId, customerId))
      .orderBy(desc(identityInquiries.createdAt))
      .limit(1);
    if (!row) return null;
    return {
      inquiryId: row.providerInquiryId,
      customerId: row.customerId,
      status: row.status as KycStatus,
      createdAt: row.createdAt,
    };
  }

  async create(record: IdentityInquiryRecord): Promise<void> {
    await this.db
      .insert(identityInquiries)
      .values({
        customerId: record.customerId,
        provider: "persona",
        providerInquiryId: record.inquiryId,
        status: record.status,
        createdAt: record.createdAt,
      })
      .onConflictDoNothing({ target: identityInquiries.providerInquiryId });
  }
}
