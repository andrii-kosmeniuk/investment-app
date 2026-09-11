import { InvalidApprovalError } from "@corgi/domain";
import { describe, expect, it } from "vitest";
import {
  InsufficientFundsError,
  ValidationError,
  applyFill,
  buildApprovalExecutors,
  decideApproval,
  explainBreak,
  generateCustodianFile,
  handleDepositReturn,
  proposeRebalanceForCustomer,
  recordTransferEvent,
  releaseTradingBlock,
  requestBreakAdjustment,
  requestWithdrawal,
  runReconciliation,
  settleDueTrades,
} from "../src/index.js";
import { InMemoryPriceRepository } from "../src/testing/in-memory-valuation.js";
import { FakePortfolios, balancedGrowth } from "./customer-fakes.js";
import {
  FakeActorDirectory,
  FakeApprovalRepository,
  FakeBroker,
  FakeCustodianFileRepository,
  FakeCustomerRepository,
  FakeOrderRepository,
  FakeReconciliationRepository,
  FakeSettlementRepository,
  FakeTaxLotRepository,
  InMemoryLedgerRepository,
  directoryOver,
  sequentialIds,
  staticResolver,
} from "./fakes.js";

const CUSTOMER = "cust-1";
const SAM = { id: "actor-sam", displayName: "Sam Chen", actorType: "human" as const, role: "ops" };
const MAYA = { id: "actor-maya", displayName: "Maya Brooks", actorType: "human" as const, role: "ops" };
const AGENT = { id: "actor-agent", displayName: "Portfolio Assistant", actorType: "agent" as const, role: "agent" };
const SYSTEM = { id: "actor-system", displayName: "Corgi System", actorType: "agent" as const, role: "system" };

/** Thursday 2026-09-10, 14:30 ET — a normal trading day. */
const THURSDAY = "2026-09-10T18:30:00Z";

function harness() {
  let now = new Date(THURSDAY);
  const clock = { now: () => now, advanceTo: (iso: string) => (now = new Date(iso)) };
  const ledger = new InMemoryLedgerRepository();
  const orders = new FakeOrderRepository();
  const deps = {
    ledger,
    clock,
    ids: sequentialIds("id"),
    resolver: staticResolver(),
    accounts: directoryOver(ledger),
    prices: new InMemoryPriceRepository(),
    taxLots: new FakeTaxLotRepository(),
    settlements: new FakeSettlementRepository(),
    orders,
    customers: new FakeCustomerRepository([{ id: CUSTOMER, kycStatus: "approved", tradingBlocked: false, brokerAccountId: "acct-1" }]),
    approvals: new FakeApprovalRepository(),
    actors: new FakeActorDirectory([SAM, MAYA, AGENT, SYSTEM]),
    custodianFiles: new FakeCustodianFileRepository(),
    reconciliation: new FakeReconciliationRepository(),
    broker: new FakeBroker(),
    portfolios: new FakePortfolios([{ customerId: CUSTOMER, modelId: balancedGrowth.id, brokerAccountId: "acct-1", status: "open" }]),
    models: { findById: (id: string) => Promise.resolve(id === balancedGrowth.id ? balancedGrowth : null) },
  };
  const executors = buildApprovalExecutors({ ...deps, confirmationThresholdCents: 100_000n });
  const decide = (requestId: string, actorId: string, decision: "approved" | "rejected" = "approved") =>
    decideApproval({ ...deps, executors }, { requestId, actorId, decision, reason: "Reviewed in test" });

  /** Deposit $1,000 and settle it. */
  const fund = async (cents = 100_000n, transferId = "tr-1") => {
    await recordTransferEvent(deps, { customerId: CUSTOMER, transferId, kind: "pending", amountCents: cents, occurredAt: new Date("2026-09-08T12:00:00Z") });
    await recordTransferEvent(deps, { customerId: CUSTOMER, transferId, kind: "settled", amountCents: cents, occurredAt: new Date("2026-09-09T12:00:00Z") });
  };
  /** Buy `units` of `symbol` at $100 through a seeded order. */
  const buy = async (symbol: string, unitsMicro: bigint, executionId: string) => {
    deps.orders.seed({ id: `o-${executionId}`, customerId: CUSTOMER, clientOrderId: `c-${executionId}`, providerOrderId: `p-${executionId}`, symbol, side: "buy", state: "accepted", cumulativeFilledUnitsMicro: 0n });
    await applyFill(deps, { executionId, providerOrderId: `p-${executionId}`, symbol, cumulativeUnitsMicro: unitsMicro, priceE8: 10_000_000_000n, occurredAt: clock.now(), terminal: true });
  };
  return { deps, clock, ledger, executors, decide, fund, buy };
}

const balance = (ledger: InMemoryLedgerRepository, accountId: string, commodity = "USD") =>
  ledger.all.flatMap((e) => e.postings).filter((p) => p.accountId === accountId && p.commodity === commodity).reduce((sum, p) => sum + p.quantity, 0n);

describe("settlement — T+1 from recorded fills", () => {
  it("records a pending settlement per fill and settles it once the date arrives", async () => {
    const { deps, clock, ledger, fund, buy } = harness();
    await fund();
    await buy("VTI", 5_000_000n, "x1"); // $500 on Thursday

    expect(deps.settlements.rows).toEqual([expect.objectContaining({ side: "buy", amountCents: 50_000n, tradeDate: "2026-09-10", contractualSettlementDate: "2026-09-11", status: "pending" })]);
    expect(balance(ledger, `${CUSTOMER}:unsettled-buys`)).toBe(-50_000n);

    expect((await settleDueTrades(deps, "2026-09-10")).settled).toHaveLength(0);
    clock.advanceTo("2026-09-11T04:05:00Z");
    const result = await settleDueTrades(deps, "2026-09-11");
    expect(result.settled).toHaveLength(1);
    expect(balance(ledger, `${CUSTOMER}:unsettled-buys`)).toBe(0n);
    expect(balance(ledger, `${CUSTOMER}:settled`)).toBe(50_000n);

    // Re-running the job is a no-op at every layer.
    const again = await settleDueTrades(deps, "2026-09-11");
    expect(again.settled).toHaveLength(0);
    expect(ledger.all.filter((e) => e.kind === "settle_buy")).toHaveLength(1);
  });

  it("skips the weekend: a Friday trade settles on Monday", async () => {
    const { deps, clock, fund, buy } = harness();
    await fund();
    clock.advanceTo("2026-09-11T18:30:00Z");
    await buy("VTI", 1_000_000n, "fri");
    expect(deps.settlements.rows[0]?.contractualSettlementDate).toBe("2026-09-14");
  });

  it("books a sell fill against FIFO lots and settles the proceeds", async () => {
    const { deps, ledger, fund, buy } = harness();
    await fund();
    await buy("VTI", 2_000_000n, "b1");
    await buy("VTI", 3_000_000n, "b2");

    deps.orders.seed({ id: "o-s1", customerId: CUSTOMER, clientOrderId: "c-s1", providerOrderId: "p-s1", symbol: "VTI", side: "sell", state: "accepted", cumulativeFilledUnitsMicro: 0n });
    const sell = { executionId: "s1", providerOrderId: "p-s1", symbol: "VTI", cumulativeUnitsMicro: 2_500_000n, priceE8: 11_000_000_000n, occurredAt: new Date(THURSDAY), terminal: true };
    await applyFill(deps, sell);
    await applyFill(deps, sell); // replay

    expect(ledger.all.filter((e) => e.kind === "sell_fill")).toHaveLength(1);
    expect(balance(ledger, `${CUSTOMER}:pos:VTI`, "VTI")).toBe(2_500_000n);
    expect(balance(ledger, `${CUSTOMER}:unsettled-sells`)).toBe(27_500n);
    // FIFO: the whole first lot (2.0) then half a unit of the second.
    expect(deps.taxLots.consumptions.map((c) => [c.units, c.realizedGain])).toEqual([
      [2_000_000n, 2_000n],
      [500_000n, 500n],
    ]);
    expect((await deps.taxLots.availableLots(CUSTOMER, "VTI")).map((l) => l.remainingUnits)).toEqual([2_500_000n]);

    await settleDueTrades(deps, "2026-09-11");
    expect(balance(ledger, `${CUSTOMER}:unsettled-sells`)).toBe(0n);
  });
});

describe("reconciliation — custodian file, breaks, aging, resolution", () => {
  it("a clean simulator file reconciles with zero breaks and reports what matched", async () => {
    const { deps, fund, buy } = harness();
    await fund();
    await buy("VTI", 5_000_000n, "x1");

    const generated = await generateCustodianFile(deps, { businessDate: "2026-09-10" });
    expect(generated.file.source).toBe("simulator");
    expect(generated.file.content).toContain(`positions,${CUSTOMER},VTI,5000000,`);

    const result = await runReconciliation(deps, { businessDate: "2026-09-10" });
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.breaks).toEqual([]);
    expect(result.matched).toEqual({ customers: 1, positions: 1, transactions: 1 });
    expect(result.fileIsStale).toBe(false);
  });

  it("reports no_file when nothing has arrived, and uses the previous day's file when today's is missing", async () => {
    const { deps, fund } = harness();
    await fund();
    expect(await runReconciliation(deps, { businessDate: "2026-09-10" })).toEqual({ status: "no_file", businessDate: "2026-09-10" });
    await generateCustodianFile(deps, { businessDate: "2026-09-09" });
    const result = await runReconciliation(deps, { businessDate: "2026-09-10" });
    expect(result.status === "completed" && result.fileIsStale).toBe(true);
  });

  it("a tampered position shows up as a break with 0-day aging and the broker's view as a third column", async () => {
    const { deps, fund, buy } = harness();
    await fund();
    await buy("VTI", 5_000_000n, "x1");
    deps.broker.getPositions = () => Promise.resolve([{ symbol: "VTI", unitsMicro: 5_000_000n }]);

    await generateCustodianFile(deps, { businessDate: "2026-09-10", tamper: { kind: "position", customerId: CUSTOMER, symbol: "VTI", deltaUnitsMicro: 1_000n } });
    const first = await runReconciliation(deps, { businessDate: "2026-09-10" });
    expect(first.status === "completed" && first.opened).toBe(1);
    const [brk] = await deps.reconciliation.listBreaks({ status: "open" });
    expect(brk).toMatchObject({ category: "position_units", key: "VTI", ledgerValue: 5_000_000n, custodianValue: 5_001_000n, delta: 1_000n, brokerValue: 5_000_000n, firstSeenBusinessDate: "2026-09-10" });

    // Next morning the file is still wrong: same break, refreshed, not duplicated.
    const second = await runReconciliation(deps, { businessDate: "2026-09-11" });
    expect(second.status === "completed" && [second.opened, second.refreshed]).toEqual([0, 1]);
    expect(await deps.reconciliation.listBreaks({ status: "open" })).toHaveLength(1);
  });

  it("a break is closed only by a human: explain, or adjust through maker-checker", async () => {
    const { deps, ledger, decide, fund, buy } = harness();
    await fund();
    await buy("VTI", 5_000_000n, "x1");
    await generateCustodianFile(deps, { businessDate: "2026-09-10", tamper: { kind: "position", customerId: CUSTOMER, symbol: "VTI", deltaUnitsMicro: -1_000n } });
    await generateCustodianFile(deps, { businessDate: "2026-09-10", tamper: { kind: "cash", customerId: CUSTOMER, deltaCents: 1n } });
    // The second file is the latest for the date, so only the cash tamper is live.
    await runReconciliation(deps, { businessDate: "2026-09-10" });
    const [cashBreak] = await deps.reconciliation.listBreaks({ status: "open" });
    expect(cashBreak?.category).toBe("cash");

    // Sam asks for an adjustment; Sam cannot approve it; Maya can.
    const request = await requestBreakAdjustment(deps, { breakId: cashBreak!.id, requestedBy: SAM, note: "Custodian rounding" });
    expect(request).toMatchObject({ kind: "recon_adjustment", amountCents: 1n });
    await expect(decide(request.id, SAM.id)).rejects.toBeInstanceOf(InvalidApprovalError);
    await expect(decide(request.id, AGENT.id)).rejects.toBeInstanceOf(InvalidApprovalError);
    const decided = await decide(request.id, MAYA.id);
    expect(decided.outcome).toMatchObject({ entry: "inserted", category: "cash", delta: "1" });
    expect((await deps.reconciliation.findBreak(cashBreak!.id))?.status).toBe("resolved");
    expect(balance(ledger, `${CUSTOMER}:settled`)).toBe(100_001n); // the buy is still unsettled
    expect(balance(ledger, "firm:rounding")).toBe(-1n);

    // Explaining needs a note and only works once.
    // A fresh file for the same date that omits the adjusting entry we just posted.
    await generateCustodianFile(deps, { businessDate: "2026-09-10", tamper: { kind: "drop_transaction", customerId: CUSTOMER, entryId: ledger.all.at(-1)!.id } });
    await runReconciliation(deps, { businessDate: "2026-09-10" });
    const open = (await deps.reconciliation.listBreaks({ status: "open" })).find((b) => b.category === "missing_transaction");
    expect(open).toBeDefined();
    await expect(requestBreakAdjustment(deps, { breakId: open!.id, requestedBy: SAM, note: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(explainBreak(deps, { breakId: open!.id, actorId: SAM.id, note: "  " })).rejects.toBeInstanceOf(ValidationError);
    const explained = await explainBreak(deps, { breakId: open!.id, actorId: SAM.id, note: "Custodian posts deposits next day" });
    expect(explained.status).toBe("explained");
    await expect(explainBreak(deps, { breakId: open!.id, actorId: SAM.id, note: "again" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("approvals — withdrawals, rebalances, rejections", () => {
  it("a withdrawal is checked against withdrawable cash, then approval books the ledger leg", async () => {
    const { deps, ledger, decide, fund, buy } = harness();
    await fund();
    await buy("VTI", 5_000_000n, "x1"); // $500 unsettled

    await expect(requestWithdrawal(deps, { customerId: CUSTOMER, amountCents: 60_000n, reason: "Rent", requestedBy: AGENT })).rejects.toBeInstanceOf(InsufficientFundsError);
    const request = await requestWithdrawal(deps, { customerId: CUSTOMER, amountCents: 40_000n, reason: "Rent", requestedBy: AGENT });
    expect(request).toMatchObject({ kind: "withdrawal", requestedByActorType: "agent", status: "pending" });

    const rejected = await decide(request.id, SAM.id, "rejected");
    expect(rejected.outcome).toBeNull();
    expect((await deps.approvals.findById(request.id))?.status).toBe("rejected");
    await expect(decide(request.id, MAYA.id)).rejects.toBeInstanceOf(InvalidApprovalError); // no longer pending

    const second = await requestWithdrawal(deps, { customerId: CUSTOMER, amountCents: 40_000n, reason: "Rent", requestedBy: AGENT });
    const approved = await decide(second.id, SAM.id);
    expect(approved.outcome).toMatchObject({ entry: "inserted", payout: "not_sent" });
    expect(balance(ledger, `${CUSTOMER}:settled`)).toBe(60_000n);
    expect(ledger.all.at(-1)).toMatchObject({ kind: "withdrawal", source: "ops" });
  });

  it("a rebalance proposal freezes drift legs; approval submits sells first and defers buys that do not fit", async () => {
    const { deps, decide, fund, buy } = harness();
    await fund(100_000n);
    await buy("VTI", 5_000_000n, "x1"); // $500 VTI, $500 cash → model wants 60/19/21 of $990
    await deps.prices.record([{ symbol: "VTI", tradeDate: "2026-09-10", price: "100", source: "test" }], deps.clock.now());

    const proposal = await proposeRebalanceForCustomer(deps, { customerId: CUSTOMER, reason: "Monthly drift check", requestedBy: AGENT });
    expect(proposal.status).toBe("filed");
    if (proposal.status !== "filed") return;
    expect(proposal.legs.map((l) => [l.symbol, l.side, l.notionalCents])).toEqual([
      ["VTI", "buy", 9_400n],
      ["VXUS", "buy", 18_810n],
      ["BND", "buy", 20_790n],
    ]);
    expect(proposal.request.amountCents).toBe(49_000n);

    const decided = await decide(proposal.request.id, MAYA.id);
    // Available to trade is $500 (settled $1,000 − unsettled buy $500): all three buys fit.
    expect(decided.outcome).toMatchObject({ legs: 3, deferredUntilSellsSettle: "none" });
    expect(deps.broker.submitted.map((o) => o.symbol)).toEqual(["VTI", "VXUS", "BND"]);
  });

  it("a customer already in balance files nothing", async () => {
    const { deps, fund } = harness();
    await fund(0n);
    const proposal = await proposeRebalanceForCustomer(deps, { customerId: CUSTOMER, reason: "Check", requestedBy: AGENT });
    expect(proposal.status).toBe("in_balance");
    expect(deps.approvals.requests).toHaveLength(0);
  });
});

describe("bounce after invest (R01)", () => {
  it("reverses the cash, blocks trading, files one sell-to-cover request, and a human approves the sell", async () => {
    const { deps, clock, ledger, decide, fund, buy } = harness();
    await fund(100_000n, "tr-1");
    await buy("VTI", 8_000_000n, "x1"); // $800 invested
    await deps.prices.record([{ symbol: "VTI", tradeDate: "2026-09-10", price: "100", source: "test" }], deps.clock.now());
    await settleDueTrades(deps, "2026-09-11"); // cash now $200 settled
    clock.advanceTo("2026-09-11T13:30:00Z");

    const returned = { customerId: CUSTOMER, transferId: "tr-1", kind: "returned" as const, amountCents: 100_000n, occurredAt: new Date("2026-09-11T13:00:00Z"), returnCode: "R01" };
    const result = await handleDepositReturn(deps, returned);
    expect(result).toMatchObject({ status: "blocked", shortfallCents: 80_000n });
    expect(deps.customers.snapshot(CUSTOMER)?.tradingBlocked).toBe(true);
    expect(balance(ledger, `${CUSTOMER}:settled`)).toBe(-80_000n);
    expect(balance(ledger, `${CUSTOMER}:bounce`)).toBe(100_000n);

    const [request] = deps.approvals.requests;
    expect(request).toMatchObject({ kind: "order", amountCents: 80_000n, requestedByActorId: SYSTEM.id, status: "pending" });
    expect(request?.payload).toMatchObject({ intent: "sell_to_cover", symbol: "VTI", side: "sell", notionalCents: "80000", returnCode: "R01" });

    // Replayed event: same ledger entry, same single request.
    const replay = await handleDepositReturn(deps, returned);
    expect(replay.status === "blocked" && replay.approvalId).toBe(request!.id);
    expect(deps.approvals.requests).toHaveLength(1);
    expect(ledger.all.filter((e) => e.kind === "deposit_returned")).toHaveLength(1);

    // Nothing is sold until a human says so; the customer cannot withdraw meanwhile.
    expect(deps.broker.submitted).toHaveLength(0);
    await expect(requestWithdrawal(deps, { customerId: CUSTOMER, amountCents: 1n, reason: "x", requestedBy: SAM })).rejects.toThrow(/cannot withdraw/);
    const decided = await decide(request!.id, SAM.id);
    expect(decided.outcome).toMatchObject({ symbol: "VTI", side: "sell", intent: "sell_to_cover" });
    expect(deps.broker.submitted).toEqual([expect.objectContaining({ symbol: "VTI", notionalCents: 80_000n })]);

    // Release is refused until the cash is whole, then closes the receivable and unblocks.
    await expect(releaseTradingBlock(deps, { customerId: CUSTOMER, actorId: MAYA.id })).rejects.toBeInstanceOf(ValidationError);
    const sellOrder = deps.broker.submitted[0]!;
    await applyFill(deps, { executionId: "cover", providerOrderId: `prov-${sellOrder.clientOrderId}`, symbol: "VTI", cumulativeUnitsMicro: 8_000_000n, priceE8: 10_000_000_000n, occurredAt: new Date("2026-09-11T14:00:00Z"), terminal: true });
    await settleDueTrades(deps, "2026-09-14");
    clock.advanceTo("2026-09-14T13:30:00Z");
    expect(balance(ledger, `${CUSTOMER}:settled`)).toBe(0n);
    const released = await releaseTradingBlock(deps, { customerId: CUSTOMER, actorId: MAYA.id });
    expect(released.recoveredCents).toBe(100_000n);
    expect(balance(ledger, `${CUSTOMER}:bounce`)).toBe(0n);
    expect(balance(ledger, "firm:sweep")).toBe(0n);
    expect(deps.customers.snapshot(CUSTOMER)?.tradingBlocked).toBe(false);
  });

  it("a return that leaves cash non-negative only reverses", async () => {
    const { deps, fund } = harness();
    await fund(100_000n, "tr-1");
    const result = await handleDepositReturn(deps, { customerId: CUSTOMER, transferId: "tr-1", kind: "returned", amountCents: 100_000n, occurredAt: new Date("2026-09-11T13:00:00Z") });
    expect(result.status).toBe("reversed");
    expect(deps.customers.snapshot(CUSTOMER)?.tradingBlocked).toBe(false);
    expect(deps.approvals.requests).toHaveLength(0);
  });
});
