import { beforeEach, describe, expect, it } from "vitest";
import { type JournalEntry, cents, microUnits, postingPatterns } from "@corgi/domain";
import {
  type ReturnPeriod,
  applyStockSplit,
  buildPerformanceView,
  computePeriodReturns,
  externalFlows,
  postJournalEntry,
  recordCloses,
  recordDividend,
  restate,
  restateForCorrectedCloses,
  valueCustomer,
  valuePortfolios,
} from "../src/index.js";
import {
  InMemoryPeriodReturnRepository,
  InMemoryPriceRepository,
  InMemoryValuationRepository,
} from "../src/testing/in-memory-valuation.js";
import { FakeTaxLotRepository, InMemoryLedgerRepository, directoryOver, sequentialIds, staticResolver } from "./fakes.js";

const CUSTOMER = "cust-1";

function harness() {
  let now = new Date("2026-09-03T21:00:00Z");
  const clock = { now: () => now, advanceTo: (iso: string) => (now = new Date(iso)) };
  const ledger = new InMemoryLedgerRepository();
  const deps = {
    ledger,
    clock,
    ids: sequentialIds("id"),
    resolver: staticResolver(),
    accounts: directoryOver(ledger),
    prices: new InMemoryPriceRepository(),
    valuations: new InMemoryValuationRepository(clock),
    returns: new InMemoryPeriodReturnRepository(clock),
    taxLots: new FakeTaxLotRepository(),
  };
  return { deps, clock, ledger };
}

async function fundAndInvest(deps: ReturnType<typeof harness>["deps"]) {
  const customer = await deps.resolver.forCustomer(CUSTOMER, ["VTI"]);
  const clearing = await deps.resolver.clearing(["VTI"]);
  const post = (key: string, kind: string, effectiveAt: string, postings: JournalEntry["postings"]) =>
    postJournalEntry(deps, {
      idempotencyKey: key,
      kind,
      effectiveAt: new Date(effectiveAt),
      postedAt: new Date(effectiveAt),
      source: "system",
      sourceRef: key,
      description: key,
      postings,
    });

  // Sep 1: $10,000 settles, 20 VTI bought at $250.
  await post("dep-1", "deposit_settled", "2026-09-01T14:00:00Z", postingPatterns.depositSettled(customer, 1_000_000n));
  await post("fill-1", "buy_fill", "2026-09-01T15:00:00Z", postingPatterns.buyFill(customer, clearing, "VTI", 20_000_000n, 500_000n, "lot-1"));
  await deps.taxLots.open({
    id: "lot-1",
    customerId: CUSTOMER,
    symbol: "VTI",
    openedEntryId: "fill-1",
    openedAt: new Date("2026-09-01T15:00:00Z"),
    units: microUnits(20_000_000n),
    basis: cents(500_000n),
  });
  // Sep 2: the buy settles (no value change) and another $1,000 arrives.
  await post("settle-1", "buy_settled", "2026-09-02T05:05:00Z", postingPatterns.settleBuy(customer, 500_000n));
  await post("dep-2", "deposit_settled", "2026-09-02T14:00:00Z", postingPatterns.depositSettled(customer, 100_000n));

  await recordCloses(deps, [
    { symbol: "VTI", tradeDate: "2026-09-01", price: "250.00000000", source: "test" },
    { symbol: "VTI", tradeDate: "2026-09-02", price: "255.00000000", source: "test" },
    { symbol: "VTI", tradeDate: "2026-09-03", price: "260.00000000", source: "test" },
  ]);
  return valuePortfolios(deps, { from: "2026-09-01", to: "2026-09-03", reason: "scheduled" });
}

const returnsOf = async (deps: ReturnType<typeof harness>["deps"], period: ReturnPeriod, end: string) =>
  deps.returns.latest(CUSTOMER, period, end);

describe("valuation job", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it("values cash + positions per business day and links returns across days", async () => {
    const runs = await fundAndInvest(h.deps);
    expect(runs.map((run) => run.valuation.status)).toEqual(["recorded", "recorded", "recorded"]);
    const series = await h.deps.valuations.series(CUSTOMER, {});
    expect(series.map((v) => [v.asOfDate, v.valueCents, v.cashCents, v.status])).toEqual([
      ["2026-09-01", 1_000_000n, 500_000n, "final"], // 5,000 cash + 20 × 250
      ["2026-09-02", 1_110_000n, 600_000n, "final"], // 6,000 cash + 20 × 255
      ["2026-09-03", 1_120_000n, 600_000n, "final"], // 6,000 cash + 20 × 260
    ]);

    const inception = (await returnsOf(h.deps, "inception", "2026-09-03"))!;
    // (11,100 − 1,000) / 10,000 × 11,200 / 11,100 − 1
    const expected = (1_010_000 / 1_000_000) * (1_120_000 / 1_110_000) - 1;
    expect(Number(inception.twrBpsE4) / 1e8).toBeCloseTo(expected, 8);
    expect(inception.flowsCents).toBe(1_100_000n);
    expect(inception.periodStart).toBe("2026-09-01");
    expect(inception.version).toBe(1);
    // Dietz over Aug 31 → Sep 3 (3 days): $10,000 in for 3/3, $1,000 in for 2/3.
    const dietz = (1_120_000 - 1_100_000) / (1_000_000 * 1 + 100_000 * (2 / 3));
    expect(Number(inception.mwrBpsE4!) / 1e8).toBeCloseTo(dietz, 8);
    expect((await returnsOf(h.deps, "mtd", "2026-09-03"))!.twrBpsE4).toBe(inception.twrBpsE4);
  });

  it("is idempotent: rerunning the same day writes no new versions", async () => {
    await fundAndInvest(h.deps);
    const before = h.deps.valuations.rows.length + h.deps.returns.rows.length;
    const rerun = await valuePortfolios(h.deps, { from: "2026-09-01", to: "2026-09-03", reason: "scheduled" });
    expect(rerun.every((run) => run.valuation.status === "unchanged")).toBe(true);
    expect(rerun.flatMap((run) => run.returns).every((r) => r.status === "unchanged")).toBe(true);
    expect(h.deps.valuations.rows.length + h.deps.returns.rows.length).toBe(before);
  });

  it("refuses to invent a value when a held position has no close", async () => {
    await fundAndInvest(h.deps);
    h.deps.prices.rows.length = 0;
    const result = await valueCustomer(h.deps, { customerId: CUSTOMER, asOfDate: "2026-09-04", reason: "scheduled" });
    expect(result).toEqual({ status: "unavailable", missingSymbols: ["VTI"] });
    expect(await computePeriodReturns(h.deps, { customerId: CUSTOMER, asOfDate: "2026-09-04", reason: "scheduled" })).toEqual([]);
  });

  it("marks a valuation provisional when the last close is stale", async () => {
    await fundAndInvest(h.deps);
    const result = await valueCustomer(h.deps, { customerId: CUSTOMER, asOfDate: "2026-09-08", reason: "scheduled" });
    expect(result.status).toBe("recorded");
    if (result.status === "recorded") expect(result.valuation.status).toBe("provisional");
  });

  it("skips weekends and rejects an inverted window", async () => {
    await fundAndInvest(h.deps);
    const runs = await valuePortfolios(h.deps, { from: "2026-09-04", to: "2026-09-07", reason: "scheduled" });
    expect(runs.map((run) => run.asOfDate)).toEqual(["2026-09-04", "2026-09-07"]);
    await expect(valuePortfolios(h.deps, { from: "2026-09-05", to: "2026-09-04", reason: "x" })).rejects.toThrow(RangeError);
  });
});

describe("external flows", () => {
  it("classifies deposits, withdrawals, fees and their reversals but not dividends or trades", () => {
    const settled = "cust-1:settled";
    const mk = (id: string, kind: string, amount: bigint, reverses?: string): JournalEntry => ({
      id,
      idempotencyKey: id,
      kind,
      effectiveAt: new Date("2026-09-02T14:00:00Z"),
      postedAt: new Date("2026-09-02T14:00:00Z"),
      source: "system",
      sourceRef: id,
      description: id,
      hash: id,
      postings: [
        { accountId: settled, commodity: "USD", quantity: amount },
        { accountId: "other", commodity: "USD", quantity: -amount },
      ],
      ...(reverses ? { reversesEntryId: reverses } : {}),
    });
    const flows = externalFlows(
      [
        mk("d", "deposit_settled", 100_000n),
        mk("f", "fee", -500n),
        mk("w", "withdrawal", -20_000n),
        mk("div", "dividend_paid", 4_000n),
        mk("fill", "buy_fill", -50_000n),
        mk("rev", "reversal", -100_000n, "d"),
      ],
      { settledCash: settled },
    );
    expect(flows).toEqual([{ date: "2026-09-02", amountCents: 100_000n - 500n - 20_000n - 100_000n }]);
  });
});

describe("restatement", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(async () => {
    h = harness();
    await fundAndInvest(h.deps);
    h.clock.advanceTo("2026-09-04T13:00:00Z");
  });

  it("corrected close → new price version, re-versioned valuations and returns, old figures still reachable", async () => {
    const publishedBefore = new Date("2026-09-03T21:00:00Z");
    const { corrections } = await recordCloses(h.deps, [{ symbol: "VTI", tradeDate: "2026-09-02", price: "256.00000000", source: "test" }]);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({ version: 2, corrected: true, supersedesId: "price-2" });

    const [result] = await restateForCorrectedCloses(h.deps, corrections);
    expect(result!.dates).toEqual(["2026-09-02", "2026-09-03"]);
    expect(result!.reason).toBe("corrected_close:VTI@2026-09-02");
    expect(result!.valuations.map((v) => v.status)).toEqual(["recorded", "unchanged"]);

    const sep2 = await h.deps.valuations.versions(CUSTOMER, "2026-09-02");
    expect(sep2.map((v) => [v.version, v.valueCents, v.supersedesId])).toEqual([
      [1, 1_110_000n, null],
      [2, 1_112_000n, sep2[0]!.id],
    ]);

    // The Sep 3 since-inception return depends on V2, so it is restated with the prior figure kept.
    const versions = await h.deps.returns.versions(CUSTOMER, "inception", "2026-09-03");
    expect(versions).toHaveLength(2);
    const previous = (1_010_000 / 1_000_000) * (1_120_000 / 1_110_000) - 1;
    const restated = (1_012_000 / 1_000_000) * (1_120_000 / 1_112_000) - 1;
    expect(Number(versions[0]!.twrBpsE4) / 1e8).toBeCloseTo(previous, 8);
    expect(Number(versions[1]!.twrBpsE4) / 1e8).toBeCloseTo(restated, 8);

    // As published on Sep 3 evening: the original numbers, no restatement pill.
    const asPublished = await h.deps.valuations.series(CUSTOMER, { publishedAt: publishedBefore });
    expect(asPublished.find((v) => v.asOfDate === "2026-09-02")!.valueCents).toBe(1_110_000n);
    expect(await h.deps.returns.latest(CUSTOMER, "inception", "2026-09-03", publishedBefore)).toMatchObject({ version: 1 });

    // The customer-facing view carries the pill.
    const view = buildPerformanceView({
      valuation: (await h.deps.valuations.series(CUSTOMER, {})).at(-1)!,
      valuationVersions: await h.deps.valuations.versions(CUSTOMER, "2026-09-03"),
      returnVersions: new Map([["inception", versions]]),
    });
    expect(view!.restated).toBeNull(); // Sep 3 value itself did not move
    expect(view!.returns[0]!.restated?.previous).toBeCloseTo(previous, 8);
    expect(view!.returns[0]!.restated?.reason).toBe("corrected_close:VTI@2026-09-02");
    expect(view!.returns[0]!.twr).toBeCloseTo(restated, 8);
  });

  it("re-recording an identical close is a no-op and restates nothing", async () => {
    const { recorded, corrections } = await recordCloses(h.deps, [{ symbol: "VTI", tradeDate: "2026-09-02", price: "255.00000000", source: "test" }]);
    expect(recorded).toEqual([]);
    expect(await restateForCorrectedCloses(h.deps, corrections)).toEqual([]);
  });

  it("late dividend → booked on ex/pay dates, valuations restated from ex-date, counted as return not flow", async () => {
    const result = await recordDividend(h.deps, {
      customerId: CUSTOMER,
      symbol: "VTI",
      exDate: "2026-09-02",
      payDate: "2026-09-03",
      amountCents: 4_000n,
      sourceRef: "div-vti-2026-09",
    });
    expect(result.entitlement.status).toBe("inserted");
    expect(result.payment?.status).toBe("inserted");
    expect(result.entitlement.entry.effectiveAt.toISOString()).toBe("2026-09-02T20:00:00.000Z");
    expect(result.entitlement.entry.postedAt.toISOString()).toBe("2026-09-04T13:00:00.000Z");
    expect(result.restatement?.dates).toEqual(["2026-09-02", "2026-09-03"]);

    const series = await h.deps.valuations.series(CUSTOMER, {});
    expect(series.map((v) => [v.asOfDate, v.valueCents, v.cashCents, v.version])).toEqual([
      ["2026-09-01", 1_000_000n, 500_000n, 1],
      ["2026-09-02", 1_114_000n, 604_000n, 2], // receivable counts from ex-date
      ["2026-09-03", 1_124_000n, 604_000n, 2], // paid: receivable → settled, same value
    ]);
    const inception = (await returnsOf(h.deps, "inception", "2026-09-03"))!;
    expect(inception.version).toBe(2);
    expect(inception.flowsCents).toBe(1_100_000n); // the dividend is not a flow
    expect(inception.reason).toBe("late_dividend:VTI@2026-09-02");
    const expected = (1_014_000 / 1_000_000) * (1_124_000 / 1_114_000) - 1;
    expect(Number(inception.twrBpsE4) / 1e8).toBeCloseTo(expected, 8);

    // Replaying the same dividend is a no-op at the ledger and produces no versions.
    const versionsBefore = h.deps.valuations.rows.length;
    const replay = await recordDividend(h.deps, {
      customerId: CUSTOMER,
      symbol: "VTI",
      exDate: "2026-09-02",
      payDate: "2026-09-03",
      amountCents: 4_000n,
      sourceRef: "div-vti-2026-09",
    });
    expect(replay.entitlement.status).toBe("duplicate");
    expect(h.deps.valuations.rows.length).toBe(versionsBefore);
  });

  it("defers the cash leg of a dividend whose pay date is in the future", async () => {
    const result = await recordDividend(h.deps, {
      customerId: CUSTOMER,
      symbol: "VTI",
      exDate: "2026-09-03",
      payDate: "2026-09-30",
      amountCents: 4_000n,
      sourceRef: "div-future",
    });
    expect(result.payment).toBeNull();
    const sep3 = (await h.deps.valuations.series(CUSTOMER, {})).at(-1)!;
    expect(sep3.cashCents).toBe(604_000n);
  });

  it("2-for-1 split → units double, basis per unit halves, value and TWR identical to the cent and bps", async () => {
    const before = await h.deps.valuations.series(CUSTOMER, {});
    const twrBefore = (await returnsOf(h.deps, "inception", "2026-09-03"))!.twrBpsE4;

    const result = await applyStockSplit(h.deps, {
      customerId: CUSTOMER,
      symbol: "VTI",
      numerator: 2n,
      denominator: 1n,
      effectiveDate: "2026-09-03",
      sourceRef: "ca-split-1",
    });
    expect(result.unitsBefore).toBe(20_000_000n);
    expect(result.unitsAfter).toBe(40_000_000n);
    expect(result.lotsAdjusted).toBe(1);
    expect(result.pricesAdjusted).toBe(1);
    expect(h.deps.taxLots.adjustments[0]).toMatchObject({
      unitsAfter: 40_000_000n,
      basisPerUnitAfter: "125.000000000000",
      ratioNumerator: 2n,
      ratioDenominator: 1n,
    });
    const close = await h.deps.prices.latestCloses(["VTI"], "2026-09-03");
    expect(close.get("VTI")).toMatchObject({ price: "130.00000000", version: 2 });

    // The Sep 3 snapshot legitimately changes (40 units @ $130, price v2) so it is re-versioned,
    // but the value is identical to the cent and the return identical to the bps.
    const after = await h.deps.valuations.series(CUSTOMER, {});
    expect(after.map((v) => [v.asOfDate, v.valueCents])).toEqual(before.map((v) => [v.asOfDate, v.valueCents]));
    expect(after.at(-1)).toMatchObject({ version: 2, positions: [{ symbol: "VTI", unitsMicro: 40_000_000n, price: "130.00000000" }] });
    expect((await returnsOf(h.deps, "inception", "2026-09-03"))!.twrBpsE4).toBe(twrBefore);
    expect(result.restatement?.returns.every((r) => r.status === "unchanged")).toBe(true);

    // No customer-facing "was" pill: nothing the customer saw has moved.
    const view = buildPerformanceView({
      valuation: after.at(-1)!,
      valuationVersions: await h.deps.valuations.versions(CUSTOMER, "2026-09-03"),
      returnVersions: new Map([["inception", await h.deps.returns.versions(CUSTOMER, "inception", "2026-09-03")]]),
    });
    expect(view!.restated).toBeNull();
    expect(view!.returns[0]!.restated).toBeNull();

    // Replay is a ledger no-op and adjusts nothing twice.
    const replay = await applyStockSplit(h.deps, {
      customerId: CUSTOMER,
      symbol: "VTI",
      numerator: 2n,
      denominator: 1n,
      effectiveDate: "2026-09-03",
      sourceRef: "ca-split-1",
    });
    expect(replay.entry.status).toBe("duplicate");
    expect(replay.lotsAdjusted).toBe(0);
    expect(replay.pricesAdjusted).toBe(0);
  });

  it("restate from a date with no valuations is a no-op", async () => {
    const result = await restate(h.deps, { customerId: CUSTOMER, fromDate: "2026-12-01", reason: "nothing" });
    expect(result.dates).toEqual([]);
  });
});
