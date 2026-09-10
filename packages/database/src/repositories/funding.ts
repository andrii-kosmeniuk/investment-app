import type {
  BankAccountRecord,
  BankAccountRepository,
  TransferDirection,
  TransferRecord,
  TransferRepository,
} from "@corgi/application";
import { desc, eq } from "drizzle-orm";
import type { TransactionalDatabase } from "../pool.js";
import { bankAccounts, transfers } from "../schema.js";

type BankRow = typeof bankAccounts.$inferSelect;
type TransferRow = typeof transfers.$inferSelect;

function toBankAccount(row: BankRow): BankAccountRecord {
  return {
    id: row.id,
    customerId: row.customerId,
    providerAccountId: row.providerAccountId,
    providerAccessToken: row.providerAccessToken,
    institutionName: row.institutionName,
    accountMask: row.accountMask,
    status: row.status === "active" ? "active" : "disconnected",
    createdAt: row.createdAt,
  };
}

function toTransfer(row: TransferRow): TransferRecord {
  return {
    id: row.id,
    customerId: row.customerId,
    bankAccountId: row.bankAccountId,
    providerTransferId: row.providerTransferId,
    direction: row.direction as TransferDirection,
    amountCents: row.amountCents,
    status: row.status,
    returnCode: row.returnCode,
    createdAt: row.createdAt,
  };
}

export class DrizzleBankAccountRepository implements BankAccountRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async listForCustomer(customerId: string): Promise<readonly BankAccountRecord[]> {
    const rows = await this.db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.customerId, customerId))
      .orderBy(bankAccounts.createdAt);
    return rows.map(toBankAccount);
  }

  async findById(id: string): Promise<BankAccountRecord | null> {
    const [row] = await this.db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1);
    return row ? toBankAccount(row) : null;
  }

  async create(record: BankAccountRecord): Promise<void> {
    await this.db.insert(bankAccounts).values({
      id: record.id,
      customerId: record.customerId,
      providerAccountId: record.providerAccountId,
      providerAccessToken: record.providerAccessToken,
      institutionName: record.institutionName,
      accountMask: record.accountMask,
      status: record.status,
      createdAt: record.createdAt,
    });
  }
}

/**
 * Transfers we initiated. Plaid events carry only the transfer id, so the
 * amount and owner are always resolved from this table (ADR-0002); lifecycle
 * state is read from the ledger, not from `status`.
 */
export class DrizzleTransferRepository implements TransferRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async create(record: TransferRecord): Promise<void> {
    await this.db.insert(transfers).values({
      id: record.id,
      customerId: record.customerId,
      bankAccountId: record.bankAccountId,
      providerTransferId: record.providerTransferId,
      direction: record.direction,
      amountCents: record.amountCents,
      status: record.status,
      returnCode: record.returnCode,
      createdAt: record.createdAt,
    });
  }

  async listForCustomer(customerId: string): Promise<readonly TransferRecord[]> {
    const rows = await this.db
      .select()
      .from(transfers)
      .where(eq(transfers.customerId, customerId))
      .orderBy(desc(transfers.createdAt));
    return rows.map(toTransfer);
  }

  async findByProviderId(
    providerTransferId: string,
  ): Promise<{ customerId: string; amountCents: bigint } | null> {
    const [row] = await this.db
      .select({ customerId: transfers.customerId, amountCents: transfers.amountCents })
      .from(transfers)
      .where(eq(transfers.providerTransferId, providerTransferId))
      .limit(1);
    return row ? { customerId: row.customerId, amountCents: row.amountCents } : null;
  }
}
