import type {
  BankAccountRecord,
  BankAccountRepository,
  CredentialsRepository,
  CustomerDirectory,
  CustomerProfile,
  FundingPort,
  IdentityInquiryRecord,
  IdentityInquiryRepository,
  IdentityPort,
  ModelCatalog,
  ModelDefinition,
  PortfolioAssignment,
  PortfolioAssignmentRepository,
  ProviderEvent,
  TransferRecord,
  TransferRepository,
} from "../src/index.js";

export class FakeCustomerDirectory implements CustomerDirectory {
  constructor(private readonly profiles: readonly CustomerProfile[]) {}

  findProfile(id: string): Promise<CustomerProfile | null> {
    return Promise.resolve(this.profiles.find((profile) => profile.id === id) ?? null);
  }

  findProfileByEmail(email: string): Promise<CustomerProfile | null> {
    return Promise.resolve(this.profiles.find((profile) => profile.email === email) ?? null);
  }
}

export class FakeCredentials implements CredentialsRepository {
  constructor(private readonly hashes: Readonly<Record<string, string>>) {}

  findPasswordHash(customerId: string): Promise<string | null> {
    return Promise.resolve(this.hashes[customerId] ?? null);
  }
}

export class FakeIdentity implements IdentityPort {
  readonly created: string[] = [];
  readonly resumed: string[] = [];

  createInquiry(customerId: string): Promise<{ inquiryId: string; sessionToken: string }> {
    this.created.push(customerId);
    return Promise.resolve({ inquiryId: `inq-${this.created.length}`, sessionToken: "tok-new" });
  }

  resumeInquiry(inquiryId: string): Promise<{ sessionToken: string }> {
    this.resumed.push(inquiryId);
    return Promise.resolve({ sessionToken: "tok-resumed" });
  }

  getStatus(): Promise<"pending" | "needs_review" | "approved" | "declined"> {
    return Promise.resolve("pending");
  }
}

export class FakeInquiries implements IdentityInquiryRepository {
  readonly records: IdentityInquiryRecord[] = [];

  constructor(seed: readonly IdentityInquiryRecord[] = []) {
    this.records.push(...seed);
  }

  latestForCustomer(customerId: string): Promise<IdentityInquiryRecord | null> {
    const own = this.records
      .filter((record) => record.customerId === customerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Promise.resolve(own[0] ?? null);
  }

  create(record: IdentityInquiryRecord): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }
}

export class FakeFunding implements FundingPort {
  readonly deposits: Array<{ accessToken: string; providerAccountId: string; amountCents: bigint; idempotencyKey: string }> = [];
  readonly exchanged: string[] = [];

  createLinkToken(): Promise<string> {
    return Promise.resolve("link-sandbox-token");
  }

  exchangePublicToken(publicToken: string): Promise<{ accessToken: string; itemId: string }> {
    this.exchanged.push(publicToken);
    return Promise.resolve({ accessToken: `access-${publicToken}`, itemId: "item-1" });
  }

  createDeposit(input: {
    customerId: string;
    accessToken: string;
    providerAccountId: string;
    amountCents: bigint;
    idempotencyKey: string;
  }): Promise<{ transferId: string; status: string }> {
    this.deposits.push(input);
    return Promise.resolve({ transferId: `xfer-${this.deposits.length}`, status: "pending" });
  }

  syncEvents(): Promise<{ events: readonly ProviderEvent[]; nextCursor: string }> {
    return Promise.resolve({ events: [], nextCursor: "0" });
  }
}

export class FakeBankAccounts implements BankAccountRepository {
  readonly records: BankAccountRecord[] = [];

  constructor(seed: readonly BankAccountRecord[] = []) {
    this.records.push(...seed);
  }

  listForCustomer(customerId: string): Promise<readonly BankAccountRecord[]> {
    return Promise.resolve(this.records.filter((record) => record.customerId === customerId));
  }

  findById(id: string): Promise<BankAccountRecord | null> {
    return Promise.resolve(this.records.find((record) => record.id === id) ?? null);
  }

  create(record: BankAccountRecord): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }
}

export class FakeTransfers implements TransferRepository {
  readonly records: TransferRecord[] = [];

  create(record: TransferRecord): Promise<void> {
    this.records.push(record);
    return Promise.resolve();
  }

  listForCustomer(customerId: string): Promise<readonly TransferRecord[]> {
    return Promise.resolve(this.records.filter((record) => record.customerId === customerId));
  }

  findByProviderId(providerTransferId: string): Promise<{ customerId: string; amountCents: bigint } | null> {
    const found = this.records.find((record) => record.providerTransferId === providerTransferId);
    return Promise.resolve(found ? { customerId: found.customerId, amountCents: found.amountCents } : null);
  }
}

export class FakeModels implements ModelCatalog {
  constructor(private readonly models: readonly ModelDefinition[]) {}

  list(): Promise<readonly ModelDefinition[]> {
    return Promise.resolve(this.models);
  }

  findByCode(code: string): Promise<ModelDefinition | null> {
    return Promise.resolve(this.models.find((model) => model.code === code) ?? null);
  }
}

export class FakePortfolios implements PortfolioAssignmentRepository {
  readonly assignments = new Map<string, PortfolioAssignment>();

  constructor(seed: readonly PortfolioAssignment[] = []) {
    for (const assignment of seed) this.assignments.set(assignment.customerId, assignment);
  }

  findForCustomer(customerId: string): Promise<PortfolioAssignment | null> {
    return Promise.resolve(this.assignments.get(customerId) ?? null);
  }

  assign(assignment: PortfolioAssignment): Promise<void> {
    this.assignments.set(assignment.customerId, assignment);
    return Promise.resolve();
  }
}

export function bankAccount(overrides: Partial<BankAccountRecord> = {}): BankAccountRecord {
  return {
    id: "bank-1",
    customerId: "cust-1",
    providerAccountId: "plaid-acct-1",
    providerAccessToken: "access-sandbox-1",
    institutionName: "Chase",
    accountMask: "4821",
    status: "active",
    createdAt: new Date("2026-09-01T12:00:00Z"),
    ...overrides,
  };
}

export const balancedGrowth: ModelDefinition = {
  id: "model-1",
  code: "balanced-growth-v1",
  name: "Balanced growth",
  riskLevel: 3,
  cashBufferBps: 100,
  allocations: [
    { symbol: "VTI", targetWeightBps: 6000, minimumTradeCents: 100n, fractionalAllowed: true },
    { symbol: "VXUS", targetWeightBps: 1900, minimumTradeCents: 100n, fractionalAllowed: true },
    { symbol: "BND", targetWeightBps: 2100, minimumTradeCents: 100n, fractionalAllowed: true },
  ],
};
