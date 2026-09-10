import { describe, expect, it } from "vitest";
import type { JournalEntry } from "@corgi/domain";
import {
  type CustomerBalances,
  type TransferRecord,
  buildActivityRows,
  buildDepositProgress,
  buildOnboardingView,
  buildPortfolioView,
} from "../src/index.js";
import { balancedGrowth } from "./customer-fakes.js";

const publishedAt = new Date("2026-09-10T20:00:00Z");

function balances(overrides: Partial<CustomerBalances> = {}): CustomerBalances {
  return {
    settledCents: 1_000n,
    pendingDepositCents: 0n,
    unsettledBuysCents: 0n,
    unsettledSellsCents: 0n,
    availableToTradeCents: 1_000n,
    withdrawableCents: 1_000n,
    dividendReceivableCents: 0n,
    positionsMicro: new Map(),
    ...overrides,
  };
}

function entry(overrides: Partial<JournalEntry> & Pick<JournalEntry, "id" | "kind" | "postings">): JournalEntry {
  return {
    idempotencyKey: `key-${overrides.id}`,
    effectiveAt: new Date("2026-09-08T14:00:00Z"),
    postedAt: new Date("2026-09-08T14:00:01Z"),
    source: "plaid",
    sourceRef: "xfer-1",
    description: "",
    hash: "h",
    ...overrides,
  };
}

describe("portfolio view", () => {
  it("values positions with half-even cents, sums cash + positions, and computes weights vs target", () => {
    const view = buildPortfolioView({
      customerId: "cust-1",
      asOf: "2026-09-10",
      publishedAt,
      balances: balances({
        settledCents: 100_000n,
        unsettledBuysCents: 59_400n,
        availableToTradeCents: 40_600n,
        withdrawableCents: 40_600n,
        dividendReceivableCents: 0n,
        positionsMicro: new Map([["VTI", 2_000_000n]]), // 2.000000 units
      }),
      prices: new Map([["VTI", { symbol: "VTI", price: "297.005", tradeDate: "2026-09-10", status: "final", version: 1 }]]),
      model: balancedGrowth,
      openOrders: [],
    });
    expect(view.positions).toEqual([
      {
        symbol: "VTI",
        unitsMicro: 2_000_000n,
        price: { symbol: "VTI", price: "297.005", tradeDate: "2026-09-10", status: "final", version: 1 },
        valueCents: 59_401n, // 594.01 (half-even on .010 → 59401)
        targetWeightBps: 6000,
        actualWeightBps: 5940,
      },
    ]);
    expect(view.value).toEqual({ cents: 40_600n + 59_401n, status: "final" });
    expect(view.cash.availableToInvestCents).toBe(40_600n);
    expect(view.model).toEqual({ code: "balanced-growth-v1", name: "Balanced growth" });
  });

  it("marks the headline unavailable when a held position has no usable price", () => {
    const view = buildPortfolioView({
      customerId: "cust-1",
      asOf: "2026-09-10",
      publishedAt,
      balances: balances({ positionsMicro: new Map([["VTI", 1_000_000n], ["BND", 1_000_000n]]) }),
      prices: new Map([["VTI", { symbol: "VTI", price: "300", tradeDate: "2026-09-10", status: "final", version: 1 }]]),
      model: null,
      openOrders: [],
    });
    expect(view.value).toEqual({ cents: null, status: "unavailable" });
    expect(view.positions.find((position) => position.symbol === "BND")).toMatchObject({
      price: null,
      valueCents: null,
      actualWeightBps: null,
      targetWeightBps: null,
    });
    expect(view.positions.find((position) => position.symbol === "VTI")?.valueCents).toBe(30_000n);
  });

  it("flags a stale close as provisional and excludes pending deposits from value", () => {
    const view = buildPortfolioView({
      customerId: "cust-1",
      asOf: "2026-09-10",
      publishedAt,
      balances: balances({ pendingDepositCents: 100_000n, positionsMicro: new Map([["BND", 1_000_000n]]) }),
      prices: new Map([["BND", { symbol: "BND", price: "72.5", tradeDate: "2026-09-08", status: "stale", version: 1 }]]),
      model: null,
      openOrders: [],
    });
    expect(view.value).toEqual({ cents: 1_000n + 7_250n, status: "provisional" });
    expect(view.cash.pendingDepositCents).toBe(100_000n);
  });

  it("is a plain cash view before any investment", () => {
    const view = buildPortfolioView({
      customerId: "cust-1",
      asOf: "2026-09-10",
      publishedAt,
      balances: balances(),
      prices: new Map(),
      model: null,
      openOrders: [],
    });
    expect(view.value).toEqual({ cents: 1_000n, status: "final" });
    expect(view.positions).toEqual([]);
    expect(view.performance).toBeNull();
  });
});

describe("activity view", () => {
  const paths = new Map([
    ["a-settled", "customer:c1:cash:settled"],
    ["a-pending", "customer:c1:cash:pending"],
    ["a-pos", "customer:c1:position:VTI"],
    ["a-unsettled", "customer:c1:cash:unsettled-buys"],
    ["f-sweep", "firm:clearing:plaid-sweep"],
    ["f-units", "firm:clearing:trading-units:VTI"],
    ["f-usd", "firm:clearing:trading-usd"],
  ]);

  it("leads with the customer's cash for deposits and with units for buys, and keeps every leg", () => {
    const rows = buildActivityRows(
      [
        entry({
          id: "e1",
          kind: "deposit_pending",
          description: "ACH debit initiated",
          postings: [
            { accountId: "a-pending", commodity: "USD", quantity: 100_000n },
            { accountId: "f-sweep", commodity: "USD", quantity: -100_000n },
          ],
        }),
        entry({
          id: "e2",
          kind: "buy_fill",
          source: "alpaca",
          sourceRef: "exec-1",
          effectiveAt: new Date("2026-09-09T14:30:00Z"),
          postedAt: new Date("2026-09-09T14:30:02Z"),
          description: "Buy VTI",
          postings: [
            { accountId: "a-pos", commodity: "VTI", quantity: 2_000_000n, lotId: "lot-1" },
            { accountId: "f-units", commodity: "VTI", quantity: -2_000_000n },
            { accountId: "a-unsettled", commodity: "USD", quantity: -59_400n },
            { accountId: "f-usd", commodity: "USD", quantity: 59_400n },
          ],
        }),
      ],
      paths,
    );
    expect(rows.map((row) => row.entryId)).toEqual(["e2", "e1"]); // newest first
    expect(rows[1]).toMatchObject({
      label: "Deposit initiated",
      amount: { accountPath: "customer:c1:cash:pending", commodity: "USD", quantity: 100_000n },
    });
    expect(rows[0]).toMatchObject({
      label: "Buy VTI",
      amount: { accountPath: "customer:c1:position:VTI", commodity: "VTI", quantity: 2_000_000n },
      reversesEntryId: null,
    });
    expect(rows[0]?.legs).toHaveLength(4);
    expect(rows[0]?.legs[1]).toEqual({ accountPath: "firm:clearing:trading-units:VTI", commodity: "VTI", quantity: -2_000_000n });
  });

  it("falls back to a humanized kind and to the raw account id when a path is unknown", () => {
    const [row] = buildActivityRows(
      [
        entry({
          id: "e3",
          kind: "custodian_adjustment",
          postings: [
            { accountId: "a-settled", commodity: "USD", quantity: -5n },
            { accountId: "mystery", commodity: "USD", quantity: 5n },
          ],
        }),
      ],
      paths,
    );
    expect(row?.label).toBe("Custodian adjustment");
    expect(row?.legs[1]?.accountPath).toBe("mystery");
  });
});

describe("onboarding view", () => {
  const profile = {
    id: "cust-1",
    email: "noah@demo.corgi",
    displayName: "Noah Williams",
    kycStatus: "not_started" as const,
    tradingBlocked: true,
  };

  it("puts identity as the current step and everything after it upcoming", () => {
    const view = buildOnboardingView({ profile, latestInquiry: null, hasBankAccount: false, hasDeposit: false, hasModel: false });
    expect(view.steps.map((step) => [step.key, step.status])).toEqual([
      ["account", "complete"],
      ["identity", "current"],
      ["bank", "upcoming"],
      ["deposit", "upcoming"],
      ["model", "upcoming"],
    ]);
    expect(view.identity).toEqual({ status: "not_started", inquiryId: null, canStart: true });
  });

  it("blocks the rail on a declined check and offers no start", () => {
    const view = buildOnboardingView({
      profile: { ...profile, kycStatus: "declined" },
      latestInquiry: { inquiryId: "inq-9", customerId: "cust-1", status: "declined", createdAt: publishedAt },
      hasBankAccount: false,
      hasDeposit: false,
      hasModel: false,
    });
    expect(view.steps[1]).toMatchObject({ key: "identity", status: "blocked" });
    expect(view.identity).toEqual({ status: "declined", inquiryId: "inq-9", canStart: false });
  });

  it("advances to the first unfinished step once verified, and never skips ahead", () => {
    const view = buildOnboardingView({
      profile: { ...profile, kycStatus: "approved", tradingBlocked: false },
      latestInquiry: null,
      hasBankAccount: true,
      hasDeposit: false,
      hasModel: true, // chosen a model but never funded: rail still points at deposit
    });
    expect(view.steps.map((step) => step.status)).toEqual(["complete", "complete", "complete", "current", "complete"]);
    expect(view.identity.canStart).toBe(false);
  });
});

describe("deposit progress", () => {
  const transfer: TransferRecord = {
    id: "t1",
    customerId: "c1",
    bankAccountId: "b1",
    providerTransferId: "xfer-1",
    direction: "deposit",
    amountCents: 100_000n,
    status: "pending",
    returnCode: null,
    createdAt: new Date("2026-09-08T13:00:00Z"),
  };
  const pending = entry({
    id: "p",
    kind: "deposit_pending",
    effectiveAt: new Date("2026-09-08T14:00:00Z"),
    postings: [{ accountId: "a", commodity: "USD", quantity: 1n }, { accountId: "b", commodity: "USD", quantity: -1n }],
  });

  it("is 'initiated' with the first step current before any ledger event", () => {
    const progress = buildDepositProgress(transfer, []);
    expect(progress.status).toBe("initiated");
    expect(progress.timeline).toEqual([
      { step: "pending", state: "current", at: transfer.createdAt },
      { step: "settled", state: "upcoming", at: null },
    ]);
  });

  it("reads pending and settled off the ledger entries keyed by the transfer id", () => {
    const settled = entry({
      id: "s",
      kind: "deposit_settled",
      effectiveAt: new Date("2026-09-09T14:00:00Z"),
      postings: pending.postings,
    });
    const other = entry({ id: "o", kind: "deposit_settled", sourceRef: "xfer-2", postings: pending.postings });
    const progress = buildDepositProgress(transfer, [pending, settled, other]);
    expect(progress.status).toBe("settled");
    expect(progress.timeline).toEqual([
      { step: "pending", state: "done", at: pending.effectiveAt },
      { step: "settled", state: "done", at: settled.effectiveAt },
    ]);
  });

  it("surfaces a return with its code and fails the settlement step", () => {
    const returned = entry({
      id: "r",
      kind: "deposit_returned",
      description: "Deposit returned by bank (R01)",
      effectiveAt: new Date("2026-09-10T09:00:00Z"),
      postings: pending.postings,
    });
    const progress = buildDepositProgress(transfer, [pending, returned]);
    expect(progress).toMatchObject({ status: "returned", returnCode: "R01" });
    expect(progress.timeline[1]).toEqual({ step: "settled", state: "failed", at: returned.effectiveAt });
  });
});
