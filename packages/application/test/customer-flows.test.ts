import { describe, expect, it } from "vitest";
import {
  ConfirmationRequiredError,
  EmailTakenError,
  NotFoundError,
  NotPermittedError,
  ValidationError,
  type CustomerRecord,
  chooseModel,
  createDeposit,
  hashPassword,
  linkBankAccount,
  placeOrder,
  signIn,
  signUp,
  startVerification,
  verifyPassword,
} from "../src/index.js";
import {
  FakeApprovalRepository,
  FakeBroker,
  FakeCustomerRepository,
  FakeOrderRepository,
  fixedClock,
  sequentialIds,
} from "./fakes.js";
import {
  FakeBankAccounts,
  FakeCredentials,
  FakeCustomerDirectory,
  FakeCustomerRegistry,
  FakeFunding,
  FakeIdentity,
  FakeInquiries,
  FakeModels,
  FakePortfolios,
  FakeTransfers,
  balancedGrowth,
  bankAccount,
} from "./customer-fakes.js";

const now = fixedClock("2026-09-10T15:00:00Z");

function customer(overrides: Partial<CustomerRecord> = {}): CustomerRecord {
  return { id: "cust-1", kycStatus: "approved", tradingBlocked: false, brokerAccountId: "acct-1", ...overrides };
}

const olivia = {
  id: "cust-1",
  email: "olivia@demo.corgi",
  displayName: "Olivia Martin",
  kycStatus: "approved" as const,
  tradingBlocked: false,
};

describe("credentials", () => {
  it("round-trips a password and rejects the wrong one", async () => {
    const stored = await hashPassword("corgi-demo-2026");
    expect(stored.startsWith("scrypt$16384$")).toBe(true);
    await expect(verifyPassword("corgi-demo-2026", stored)).resolves.toBe(true);
    await expect(verifyPassword("corgi-demo-2025", stored)).resolves.toBe(false);
  });

  it("never verifies against a malformed stored value", async () => {
    await expect(verifyPassword("anything", "plaintext")).resolves.toBe(false);
    await expect(verifyPassword("anything", "scrypt$abc$x$y")).resolves.toBe(false);
  });
});

describe("sign-in", () => {
  const directory = new FakeCustomerDirectory([olivia]);

  it("returns the profile for a valid email + password", async () => {
    const credentials = new FakeCredentials({ "cust-1": await hashPassword("secret") });
    const profile = await signIn({ directory, credentials }, { email: " Olivia@Demo.Corgi ", password: "secret" });
    expect(profile).toEqual(olivia);
  });

  it("returns null for a wrong password, an unknown email, or a customer without credentials", async () => {
    const credentials = new FakeCredentials({ "cust-1": await hashPassword("secret") });
    await expect(signIn({ directory, credentials }, { email: "olivia@demo.corgi", password: "nope" })).resolves.toBeNull();
    await expect(signIn({ directory, credentials }, { email: "nobody@demo.corgi", password: "secret" })).resolves.toBeNull();
    await expect(
      signIn({ directory, credentials: new FakeCredentials({}) }, { email: "olivia@demo.corgi", password: "secret" }),
    ).resolves.toBeNull();
  });

  it("still runs the verifier when the email is unknown (no timing oracle)", async () => {
    let calls = 0;
    const verify = () => {
      calls += 1;
      return Promise.resolve(false);
    };
    await signIn({ directory, credentials: new FakeCredentials({}), verify }, { email: "nobody@x.io", password: "p" });
    expect(calls).toBe(1);
  });
});

describe("sign-up (ADR-0006)", () => {
  const command = { email: " Ada@Example.com ", password: "long-enough-password", displayName: "  Ada   Lovelace " };

  it("normalises the input, hashes the password once, and registers a not-yet-verified customer", async () => {
    const registry = new FakeCustomerRegistry();
    const profile = await signUp(
      { directory: new FakeCustomerDirectory([olivia]), registry, ids: sequentialIds("cust") },
      command,
    );
    expect(profile).toEqual({
      id: "cust-1",
      email: "ada@example.com",
      displayName: "Ada Lovelace",
      kycStatus: "not_started",
      tradingBlocked: true,
    });
    expect(registry.created).toHaveLength(1);
    await expect(verifyPassword("long-enough-password", registry.created[0]!.passwordHash)).resolves.toBe(true);
  });

  it("refuses an email that already exists before hashing anything", async () => {
    const registry = new FakeCustomerRegistry();
    let hashed = 0;
    const hash = (password: string) => {
      hashed += 1;
      return hashPassword(password);
    };
    await expect(
      signUp(
        { directory: new FakeCustomerDirectory([olivia]), registry, ids: sequentialIds("cust"), hash },
        { ...command, email: "OLIVIA@demo.corgi" },
      ),
    ).rejects.toBeInstanceOf(EmailTakenError);
    expect(hashed).toBe(0);
    expect(registry.created).toHaveLength(0);
  });

  it("rejects short passwords and blank names as validation errors", async () => {
    const deps = { directory: new FakeCustomerDirectory([]), registry: new FakeCustomerRegistry(), ids: sequentialIds("cust") };
    await expect(signUp(deps, { ...command, password: "short" })).rejects.toBeInstanceOf(ValidationError);
    await expect(signUp(deps, { ...command, displayName: " x " })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("onboarding — start verification", () => {
  it("creates an inquiry, records it, and moves KYC to pending with trading blocked", async () => {
    const customers = new FakeCustomerRepository([customer({ kycStatus: "not_started", tradingBlocked: true })]);
    const inquiries = new FakeInquiries();
    const identity = new FakeIdentity();
    const session = await startVerification({ customers, inquiries, identity, clock: now }, "cust-1");
    expect(session).toEqual({ inquiryId: "inq-1", sessionToken: "tok-new" });
    expect(inquiries.records).toHaveLength(1);
    expect(inquiries.records[0]).toMatchObject({ customerId: "cust-1", status: "pending" });
    expect(customers.snapshot("cust-1")).toMatchObject({ kycStatus: "pending", tradingBlocked: true });
  });

  it("resumes an open inquiry instead of creating a second one", async () => {
    const customers = new FakeCustomerRepository([customer({ kycStatus: "pending", tradingBlocked: true })]);
    const inquiries = new FakeInquiries([
      { inquiryId: "inq-open", customerId: "cust-1", status: "pending", createdAt: now.now() },
    ]);
    const identity = new FakeIdentity();
    const session = await startVerification({ customers, inquiries, identity, clock: now }, "cust-1");
    expect(session).toEqual({ inquiryId: "inq-open", sessionToken: "tok-resumed" });
    expect(identity.created).toHaveLength(0);
    expect(inquiries.records).toHaveLength(1);
  });

  it("starts a fresh inquiry after a declined one", async () => {
    const customers = new FakeCustomerRepository([customer({ kycStatus: "declined", tradingBlocked: true })]);
    const inquiries = new FakeInquiries([
      { inquiryId: "inq-declined", customerId: "cust-1", status: "declined", createdAt: now.now() },
    ]);
    const identity = new FakeIdentity();
    const session = await startVerification({ customers, inquiries, identity, clock: now }, "cust-1");
    expect(session.inquiryId).toBe("inq-1");
    expect(identity.resumed).toHaveLength(0);
  });

  it("refuses when the customer is already approved", async () => {
    const customers = new FakeCustomerRepository([customer()]);
    await expect(
      startVerification({ customers, inquiries: new FakeInquiries(), identity: new FakeIdentity(), clock: now }, "cust-1"),
    ).rejects.toBeInstanceOf(NotPermittedError);
  });
});

describe("funding — link a bank account", () => {
  it("exchanges the public token and stores the account without touching the ledger", async () => {
    const funding = new FakeFunding();
    const bankAccounts = new FakeBankAccounts();
    const record = await linkBankAccount(
      { funding, bankAccounts, ids: sequentialIds("bank"), clock: now },
      { customerId: "cust-1", publicToken: "public-1", providerAccountId: "acct-9", institutionName: "Chase", accountMask: "4821" },
    );
    expect(funding.exchanged).toEqual(["public-1"]);
    expect(record).toMatchObject({
      id: "bank-1",
      providerAccessToken: "access-public-1",
      providerAccountId: "acct-9",
      status: "active",
    });
    expect(bankAccounts.records).toHaveLength(1);
  });
});

describe("funding — create a deposit", () => {
  function deps(overrides: Partial<Parameters<typeof createDeposit>[0]> = {}) {
    return {
      customers: new FakeCustomerRepository([customer()]),
      bankAccounts: new FakeBankAccounts([bankAccount()]),
      transfers: new FakeTransfers(),
      funding: new FakeFunding(),
      ids: sequentialIds("id"),
      clock: now,
      maximumDepositCents: 50_000_00n,
      ...overrides,
    };
  }

  it("initiates the debit with the bank's credentials and records the transfer before any event", async () => {
    const d = deps();
    const record = await createDeposit(d, { customerId: "cust-1", bankAccountId: "bank-1", amountCents: 100_000n });
    expect(d.funding.deposits).toEqual([
      {
        customerId: "cust-1",
        accessToken: "access-sandbox-1",
        providerAccountId: "plaid-acct-1",
        amountCents: 100_000n,
        idempotencyKey: "id-1",
      },
    ]);
    expect(record).toMatchObject({
      id: "id-2",
      providerTransferId: "xfer-1",
      direction: "deposit",
      amountCents: 100_000n,
      status: "pending",
      returnCode: null,
    });
    expect(d.transfers.records).toHaveLength(1);
  });

  it("rejects before KYC approval, and never calls the provider", async () => {
    const d = deps({ customers: new FakeCustomerRepository([customer({ kycStatus: "pending" })]) });
    await expect(
      createDeposit(d, { customerId: "cust-1", bankAccountId: "bank-1", amountCents: 100_00n }),
    ).rejects.toBeInstanceOf(NotPermittedError);
    expect(d.funding.deposits).toHaveLength(0);
  });

  it("rejects non-positive and over-limit amounts", async () => {
    const d = deps();
    await expect(createDeposit(d, { customerId: "cust-1", bankAccountId: "bank-1", amountCents: 0n })).rejects.toBeInstanceOf(ValidationError);
    await expect(createDeposit(d, { customerId: "cust-1", bankAccountId: "bank-1", amountCents: 50_000_01n })).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a bank account that belongs to someone else or is disconnected", async () => {
    const other = deps({ bankAccounts: new FakeBankAccounts([bankAccount({ customerId: "cust-2" })]) });
    await expect(createDeposit(other, { customerId: "cust-1", bankAccountId: "bank-1", amountCents: 100n })).rejects.toBeInstanceOf(NotFoundError);
    const disconnected = deps({ bankAccounts: new FakeBankAccounts([bankAccount({ status: "disconnected" })]) });
    await expect(createDeposit(disconnected, { customerId: "cust-1", bankAccountId: "bank-1", amountCents: 100n })).rejects.toBeInstanceOf(NotPermittedError);
  });
});

describe("investing — choose a model", () => {
  function deps(overrides: Partial<Parameters<typeof chooseModel>[0]> = {}) {
    return {
      customers: new FakeCustomerRepository([customer()]),
      orders: new FakeOrderRepository(),
      broker: new FakeBroker(),
      approvals: new FakeApprovalRepository(),
      clock: now,
      ids: sequentialIds("id"),
      getAvailableToTradeCents: () => Promise.resolve(100_000n),
      confirmationThresholdCents: 100_000n,
      models: new FakeModels([balancedGrowth]),
      portfolios: new FakePortfolios([{ customerId: "cust-1", modelId: "old", brokerAccountId: "acct-1", status: "open" }]),
      ...overrides,
    };
  }

  const command = { customerId: "cust-1", modelCode: "balanced-growth-v1", requestedByActorId: "cust-1", confirmed: false };

  it("splits investable cash after the buffer so the legs reconcile to the cent", async () => {
    const d = deps();
    const result = await chooseModel(d, command);
    // $1,000.00 − 1% buffer = $990.00 → 60 / 19 / 21 %
    expect(result.legs).toEqual([
      { symbol: "VTI", notionalCents: 59_400n, status: "submitted" },
      { symbol: "VXUS", notionalCents: 18_810n, status: "submitted" },
      { symbol: "BND", notionalCents: 20_790n, status: "submitted" },
    ]);
    expect(result.legs.reduce((sum, leg) => sum + leg.notionalCents, 0n)).toBe(99_000n);
    expect(d.broker.submitted.map((order) => order.symbol)).toEqual(["VTI", "VXUS", "BND"]);
    expect(d.portfolios.assignments.get("cust-1")).toMatchObject({ modelId: "model-1", brokerAccountId: "acct-1" });
  });

  it("opens a broker account on first selection and reuses it afterwards", async () => {
    const portfolios = new FakePortfolios();
    const d = deps({ portfolios });
    await chooseModel(d, command);
    expect(portfolios.assignments.get("cust-1")?.brokerAccountId).toBe("acct-cust-1");
  });

  it("records the model but places nothing when there is no settled cash", async () => {
    const d = deps({ getAvailableToTradeCents: () => Promise.resolve(0n) });
    const result = await chooseModel(d, command);
    expect(result.legs).toEqual([]);
    expect(d.broker.submitted).toHaveLength(0);
    expect(d.portfolios.assignments.get("cust-1")?.modelId).toBe("model-1");
  });

  it("stops for explicit confirmation when any leg reaches the threshold, then places all legs once confirmed", async () => {
    const d = deps({ getAvailableToTradeCents: () => Promise.resolve(200_000n) });
    // VTI leg = 60% of $1,980.00 = $1,188.00 ≥ $1,000 threshold
    const error = await chooseModel(d, command).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfirmationRequiredError);
    expect((error as ConfirmationRequiredError).legs).toEqual([
      { symbol: "VTI", notionalCents: 118_800n },
      { symbol: "VXUS", notionalCents: 37_620n },
      { symbol: "BND", notionalCents: 41_580n },
    ]);
    expect(d.broker.submitted).toHaveLength(0);
    expect(d.approvals.requests).toHaveLength(0);

    const result = await chooseModel(d, { ...command, confirmed: true });
    expect(result.legs.map((leg) => leg.status)).toEqual(["submitted", "submitted", "submitted"]);
    expect(d.broker.submitted).toHaveLength(3);
    expect(d.approvals.requests).toHaveLength(0); // customer buys never enter the ops queue
  });

  it("refuses unknown models and customers who may not trade", async () => {
    await expect(chooseModel(deps(), { ...command, modelCode: "nope" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      chooseModel(deps({ customers: new FakeCustomerRepository([customer({ tradingBlocked: true })]) }), command),
    ).rejects.toBeInstanceOf(NotPermittedError);
  });
});

describe("investing — place order confirmation flag", () => {
  it("skips the approval diversion only when the customer confirmed", async () => {
    const approvals = new FakeApprovalRepository();
    const broker = new FakeBroker();
    const base = {
      customers: new FakeCustomerRepository([customer()]),
      orders: new FakeOrderRepository(),
      broker,
      approvals,
      clock: now,
      ids: sequentialIds("id"),
      getAvailableToTradeCents: () => Promise.resolve(500_000n),
      confirmationThresholdCents: 100_000n,
    };
    const large = { customerId: "cust-1", symbol: "VTI", notionalCents: 150_000n, side: "buy" as const, requestedByActorId: "ops-1" };
    await expect(placeOrder(base, large)).resolves.toMatchObject({ status: "pending_approval" });
    await expect(placeOrder(base, { ...large, customerConfirmed: true })).resolves.toMatchObject({ status: "submitted" });
    expect(approvals.requests).toHaveLength(1);
    expect(broker.submitted).toHaveLength(1);
  });
});
