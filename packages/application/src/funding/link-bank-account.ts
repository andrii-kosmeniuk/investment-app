import type {
  BankAccountRecord,
  BankAccountRepository,
  Clock,
  FundingPort,
  IdGenerator,
} from "../ports.js";

export interface LinkBankAccountDeps {
  readonly funding: FundingPort;
  readonly bankAccounts: BankAccountRepository;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface LinkBankAccountCommand {
  readonly customerId: string;
  readonly publicToken: string;
  readonly providerAccountId: string;
  readonly institutionName: string;
  readonly accountMask: string;
}

/**
 * Turns a completed Link session into a durable bank account. Linking is not a
 * deposit: nothing touches the ledger here, and the UI must not imply funding.
 */
export async function linkBankAccount(
  deps: LinkBankAccountDeps,
  command: LinkBankAccountCommand,
): Promise<BankAccountRecord> {
  const exchanged = await deps.funding.exchangePublicToken(command.publicToken);
  const record: BankAccountRecord = {
    id: deps.ids.next(),
    customerId: command.customerId,
    providerAccountId: command.providerAccountId,
    providerAccessToken: exchanged.accessToken,
    institutionName: command.institutionName,
    accountMask: command.accountMask,
    status: "active",
    createdAt: deps.clock.now(),
  };
  await deps.bankAccounts.create(record);
  return record;
}
