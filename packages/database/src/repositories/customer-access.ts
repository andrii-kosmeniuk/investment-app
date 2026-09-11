import {
  type CredentialsRepository,
  type CustomerDirectory,
  type CustomerProfile,
  type CustomerRegistry,
  EmailTakenError,
  type IdentityInquiryRecord,
  type IdentityInquiryRepository,
  type KycStatus,
  type NewCustomer,
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

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 4; depth += 1) {
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Self-serve registration (ADR-0006). Profile and credential are written in
 * one transaction so a customer can never exist without a way to sign in; the
 * email uniqueness constraint is the only guard against a race between two
 * registrations, surfaced as `EmailTakenError`.
 */
export class DrizzleCustomerRegistry implements CustomerRegistry {
  constructor(private readonly db: TransactionalDatabase) {}

  async create(customer: NewCustomer): Promise<CustomerProfile> {
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(customers)
          .values({
            id: customer.id,
            email: customer.email,
            displayName: customer.displayName,
            kycStatus: "not_started",
            tradingBlocked: true,
          })
          .returning();
        if (!row) throw new Error("Customer insert returned no row");
        await tx.insert(customerCredentials).values({ customerId: row.id, passwordHash: customer.passwordHash });
        return toProfile(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new EmailTakenError("An account with this email already exists");
      throw error;
    }
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
