import { describe, expect, it } from "vitest";
import {
  InsufficientFundsError,
  OrderNotPermittedError,
  type CustomerRecord,
  applyFill,
  applyInquiryStatus,
  placeOrder,
  recordTransferEvent,
} from "../src/index.js";
import {
  FakeApprovalRepository,
  FakeBroker,
  FakeCustomerRepository,
  FakeOrderRepository,
  FakeSettlementRepository,
  FakeTaxLotRepository,
  InMemoryLedgerRepository,
  fixedClock,
  sequentialIds,
  staticResolver,
} from "./fakes.js";

const occurredAt = new Date("2026-09-03T14:30:00Z");

function approvedCustomer(overrides: Partial<CustomerRecord> = {}): CustomerRecord {
  return {
    id: "cust-1",
    kycStatus: "approved",
    tradingBlocked: false,
    brokerAccountId: "acct-1",
    ...overrides,
  };
}

describe("onboarding — KYC gate", () => {
  it("unblocks trading only when the inquiry is approved", async () => {
    const customers = new FakeCustomerRepository([
      approvedCustomer({ kycStatus: "pending", tradingBlocked: true }),
    ]);
    await applyInquiryStatus({ customers }, { customerId: "cust-1", status: "approved", occurredAt });
    expect(customers.snapshot("cust-1")).toMatchObject({
      kycStatus: "approved",
      tradingBlocked: false,
    });
  });

  it("keeps trading blocked when declined", async () => {
    const customers = new FakeCustomerRepository([approvedCustomer()]);
    await applyInquiryStatus({ customers }, { customerId: "cust-1", status: "declined", occurredAt });
    expect(customers.snapshot("cust-1")).toMatchObject({
      kycStatus: "declined",
      tradingBlocked: true,
    });
  });
});

describe("funding — transfer events to ledger", () => {
  function makeDeps() {
    return {
      ledger: new InMemoryLedgerRepository(),
      clock: fixedClock("2026-09-03T14:30:00Z"),
      ids: sequentialIds(),
      resolver: staticResolver(),
    };
  }

  it("books pending, settled, and returned deposits", async () => {
    const deps = makeDeps();
    await recordTransferEvent(deps, {
      customerId: "cust-1",
      transferId: "tr_1",
      kind: "pending",
      amountCents: 100_000n,
      occurredAt,
    });
    await recordTransferEvent(deps, {
      customerId: "cust-1",
      transferId: "tr_1",
      kind: "settled",
      amountCents: 100_000n,
      occurredAt,
    });
    await recordTransferEvent(deps, {
      customerId: "cust-1",
      transferId: "tr_1",
      kind: "returned",
      amountCents: 100_000n,
      occurredAt,
      returnCode: "R01",
    });

    const entries = deps.ledger.all;
    expect(entries.map((entry) => entry.kind)).toEqual([
      "deposit_pending",
      "deposit_settled",
      "deposit_returned",
    ]);
    const returned = entries[2];
    expect(returned?.description).toContain("R01");
    const pendingLeg = entries[0]?.postings.find((p) => p.accountId === "cust-1:pending");
    expect(pendingLeg?.quantity).toBe(100_000n);
  });

  it("is idempotent when a transfer event is re-synced", async () => {
    const deps = makeDeps();
    const event = {
      customerId: "cust-1",
      transferId: "tr_1",
      kind: "settled" as const,
      amountCents: 100_000n,
      occurredAt,
    };
    await recordTransferEvent(deps, event);
    await recordTransferEvent(deps, event);
    expect(deps.ledger.all).toHaveLength(1);
  });
});

describe("investing — place order controls", () => {
  function makeDeps(available: bigint, customer = approvedCustomer()) {
    return {
      customers: new FakeCustomerRepository([customer]),
      orders: new FakeOrderRepository(),
      broker: new FakeBroker(),
      approvals: new FakeApprovalRepository(),
      clock: fixedClock("2026-09-03T14:30:00Z"),
      ids: sequentialIds(),
      getAvailableToTradeCents: () => Promise.resolve(available),
      confirmationThresholdCents: 100_000n,
    };
  }

  const buy = {
    customerId: "cust-1",
    symbol: "VTI",
    side: "buy" as const,
    requestedByActorId: "cust-1",
  };

  it("submits a below-threshold order to the broker", async () => {
    const deps = makeDeps(1_000_000n);
    const result = await placeOrder(deps, { ...buy, notionalCents: 50_000n });
    expect(result.status).toBe("submitted");
    expect(deps.broker.submitted).toHaveLength(1);
  });

  it("routes an at-threshold order to maker-checker instead of the broker", async () => {
    const deps = makeDeps(1_000_000n);
    const result = await placeOrder(deps, { ...buy, notionalCents: 100_000n });
    expect(result.status).toBe("pending_approval");
    expect(deps.broker.submitted).toHaveLength(0);
    expect(deps.approvals.requests).toHaveLength(1);
    expect(deps.approvals.requests[0]?.kind).toBe("order");
  });

  it("rejects an order that exceeds available funds", async () => {
    const deps = makeDeps(5_000n);
    await expect(
      placeOrder(deps, { ...buy, notionalCents: 6_000n }),
    ).rejects.toBeInstanceOf(InsufficientFundsError);
  });

  it("rejects trading before KYC approval", async () => {
    const deps = makeDeps(1_000_000n, approvedCustomer({ kycStatus: "pending", tradingBlocked: true }));
    await expect(
      placeOrder(deps, { ...buy, notionalCents: 10_000n }),
    ).rejects.toBeInstanceOf(OrderNotPermittedError);
  });
});

describe("investing — apply fills", () => {
  function makeDeps() {
    const orders = new FakeOrderRepository();
    orders.seed({
      id: "o1",
      customerId: "cust-1",
      clientOrderId: "c1",
      providerOrderId: "prov-1",
      symbol: "VTI",
      side: "buy",
      state: "accepted",
      cumulativeFilledUnitsMicro: 0n,
    });
    return {
      ledger: new InMemoryLedgerRepository(),
      clock: fixedClock("2026-09-03T14:30:00Z"),
      ids: sequentialIds(),
      resolver: staticResolver(),
      orders,
      taxLots: new FakeTaxLotRepository(),
      settlements: new FakeSettlementRepository(),
    };
  }

  it("posts a buy fill, opens a lot, and is idempotent on replay", async () => {
    const deps = makeDeps();
    const fill = {
      executionId: "x1",
      providerOrderId: "prov-1",
      symbol: "VTI",
      cumulativeUnitsMicro: 10_000_000n,
      priceE8: 10_000_000_000n, // $100.00
      occurredAt,
      terminal: true,
    };

    await applyFill(deps, fill);
    await applyFill(deps, fill);

    expect(deps.ledger.all).toHaveLength(1);
    expect(deps.ledger.all[0]?.kind).toBe("buy_fill");
    expect(deps.taxLots.lots).toHaveLength(1);
    expect(deps.taxLots.lots[0]).toMatchObject({ units: 10_000_000n, basis: 100_000n });
    expect(await deps.orders.findByProviderOrderId("prov-1")).toMatchObject({ state: "filled" });
  });

  it("books only incremental units across a partial then final fill", async () => {
    const deps = makeDeps();
    await applyFill(deps, {
      executionId: "x1",
      providerOrderId: "prov-1",
      symbol: "VTI",
      cumulativeUnitsMicro: 4_000_000n,
      priceE8: 10_000_000_000n,
      occurredAt,
      terminal: false,
    });
    await applyFill(deps, {
      executionId: "x2",
      providerOrderId: "prov-1",
      symbol: "VTI",
      cumulativeUnitsMicro: 10_000_000n,
      priceE8: 10_000_000_000n,
      occurredAt,
      terminal: true,
    });

    expect(deps.ledger.all).toHaveLength(2);
    expect(deps.taxLots.lots.map((lot) => lot.units)).toEqual([4_000_000n, 6_000_000n]);
    expect(await deps.orders.findByProviderOrderId("prov-1")).toMatchObject({
      state: "filled",
      cumulativeFilledUnitsMicro: 10_000_000n,
    });
  });
});
