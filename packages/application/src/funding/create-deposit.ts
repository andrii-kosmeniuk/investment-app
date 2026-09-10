import { NotFoundError, NotPermittedError, ValidationError } from "../errors.js";
import type {
  BankAccountRepository,
  Clock,
  CustomerRepository,
  FundingPort,
  IdGenerator,
  TransferRecord,
  TransferRepository,
} from "../ports.js";

export interface CreateDepositDeps {
  readonly customers: CustomerRepository;
  readonly bankAccounts: BankAccountRepository;
  readonly transfers: TransferRepository;
  readonly funding: FundingPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** Single-deposit ceiling; sandbox rails reject larger debits. */
  readonly maximumDepositCents: bigint;
}

export interface CreateDepositCommand {
  readonly customerId: string;
  readonly bankAccountId: string;
  readonly amountCents: bigint;
}

/**
 * Initiates an ACH debit from a linked bank. The transfer row is written before
 * any provider event can arrive, because Plaid events carry no amount (ADR-0002).
 * Cash reaches the ledger only through those events, never from this call.
 */
export async function createDeposit(
  deps: CreateDepositDeps,
  command: CreateDepositCommand,
): Promise<TransferRecord> {
  const customer = await deps.customers.findById(command.customerId);
  if (!customer) throw new NotFoundError(`unknown customer: ${command.customerId}`);
  if (customer.kycStatus !== "approved") {
    throw new NotPermittedError("Identity verification must be approved before adding money");
  }
  if (command.amountCents <= 0n) throw new ValidationError("Deposit amount must be positive");
  if (command.amountCents > deps.maximumDepositCents) {
    throw new ValidationError("Deposit amount exceeds the single-transfer limit");
  }

  const bank = await deps.bankAccounts.findById(command.bankAccountId);
  if (!bank || bank.customerId !== command.customerId) {
    throw new NotFoundError("Bank account is not linked to this customer");
  }
  if (bank.status !== "active") throw new NotPermittedError("Bank account is disconnected");

  const idempotencyKey = deps.ids.next();
  const created = await deps.funding.createDeposit({
    customerId: command.customerId,
    accessToken: bank.providerAccessToken,
    providerAccountId: bank.providerAccountId,
    amountCents: command.amountCents,
    idempotencyKey,
  });

  const record: TransferRecord = {
    id: deps.ids.next(),
    customerId: command.customerId,
    bankAccountId: bank.id,
    providerTransferId: created.transferId,
    direction: "deposit",
    amountCents: command.amountCents,
    status: created.status,
    returnCode: null,
    createdAt: deps.clock.now(),
  };
  await deps.transfers.create(record);
  return record;
}
