import { describe, expect, it } from "vitest";
import {
  addDays,
  bpsE4ToReturn,
  businessDate,
  daysBetween,
  endOfBusinessDay,
  firstOfMonth,
  firstOfYear,
  isWeekend,
  periodReturn,
  previousBusinessDay,
  returnToBpsE4,
  subPeriods,
} from "../src/index.js";

describe("market calendar", () => {
  it("derives the business date in New York, not UTC", () => {
    // 03:00Z on Sep 10 is still 23:00 EDT on Sep 9.
    expect(businessDate(new Date("2026-09-10T03:00:00Z"))).toBe("2026-09-09");
    expect(businessDate(new Date("2026-09-10T04:00:00Z"))).toBe("2026-09-10");
  });

  it("ends the business day at 23:59:59.999 New York time in both DST regimes", () => {
    expect(endOfBusinessDay("2026-09-09").toISOString()).toBe("2026-09-10T03:59:59.999Z");
    expect(endOfBusinessDay("2026-01-15").toISOString()).toBe("2026-01-16T04:59:59.999Z");
  });

  it("does day arithmetic on ISO dates", () => {
    expect(daysBetween("2026-08-30", "2026-09-02")).toBe(3);
    expect(daysBetween("2026-09-02", "2026-08-30")).toBe(-3);
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(firstOfMonth("2026-09-17")).toBe("2026-09-01");
    expect(firstOfYear("2026-09-17")).toBe("2026-01-01");
    expect(isWeekend("2026-09-12")).toBe(true);
    expect(isWeekend("2026-09-14")).toBe(false);
    expect(previousBusinessDay("2026-09-14")).toBe("2026-09-11"); // Monday → Friday
    expect(previousBusinessDay("2026-09-11")).toBe("2026-09-10");
    expect(() => daysBetween("2026/09/12", "2026-09-14")).toThrow(TypeError);
  });
});

describe("period returns from a valuation series", () => {
  const points = [
    { date: "2026-09-01", valueCents: 1_000_000n },
    { date: "2026-09-02", valueCents: 1_100_000n },
    // Deposit of $50 arrives on the 3rd; value ends at $168 → market did +7.27% on $110.
    { date: "2026-09-03", valueCents: 1_680_000n },
  ];
  const flows = [{ date: "2026-09-03", amountCents: 500_000n }];

  it("attributes flows to the sub-period they fall in", () => {
    const periods = subPeriods(points, flows);
    expect(periods).toEqual([
      { openingValue: 1_000_000n, closingValue: 1_100_000n, externalFlow: 0n },
      { openingValue: 1_100_000n, closingValue: 1_680_000n, externalFlow: 500_000n },
    ]);
  });

  it("chain-links sub-period returns and reports flows", () => {
    const result = periodReturn(points[0]!, points.slice(1), flows);
    expect(result.twr).toBeCloseTo(1.1 * (1_680_000 - 500_000) / 1_100_000 - 1, 10);
    expect(result.flowsCents).toBe(500_000n);
    expect(result.openingValueCents).toBe(1_000_000n);
    expect(result.closingValueCents).toBe(1_680_000n);
  });

  it("does not reward a deposit and does not punish a fee that is a flow", () => {
    const deposit = periodReturn(
      { date: "2026-09-01", valueCents: 1_000_000n },
      [{ date: "2026-09-02", valueCents: 1_500_000n }],
      [{ date: "2026-09-02", amountCents: 500_000n }],
    );
    expect(deposit.twr).toBe(0);
    const fee = periodReturn(
      { date: "2026-09-01", valueCents: 1_000_000n },
      [{ date: "2026-09-02", valueCents: 999_000n }],
      [{ date: "2026-09-02", amountCents: -1_000n }],
    );
    expect(fee.twr).toBe(0);
  });

  it("counts a dividend as return because it is not an external flow", () => {
    const result = periodReturn(
      { date: "2026-09-01", valueCents: 1_000_000n },
      [{ date: "2026-09-02", valueCents: 1_010_000n }],
      [],
    );
    expect(result.twr).toBeCloseTo(0.01, 12);
  });

  it("starts the chain at inception and gives the first deposit full Dietz weight", () => {
    const result = periodReturn(
      null,
      [
        { date: "2026-09-01", valueCents: 1_000_000n },
        { date: "2026-09-10", valueCents: 1_050_000n },
      ],
      [{ date: "2026-09-01", amountCents: 1_000_000n }],
    );
    expect(result.twr).toBeCloseTo(0.05, 12);
    expect(result.mwr).toBeCloseTo(0.05, 12);
  });

  it("weights a mid-period deposit by the fraction of the period it was invested", () => {
    // Opening $100 on the 1st, $100 deposited on the 6th of a 10-day period, closing $220.
    const result = periodReturn(
      { date: "2026-09-01", valueCents: 10_000n },
      [{ date: "2026-09-11", valueCents: 22_000n }],
      [{ date: "2026-09-06", amountCents: 10_000n }],
    );
    // gain = 220 − 100 − 100 = 20; denominator = 100 + 100 × (6/10)
    expect(result.mwr).toBeCloseTo(20 / 160, 12);
  });

  it("returns null MWR when nothing was ever invested", () => {
    const result = periodReturn(null, [{ date: "2026-09-01", valueCents: 0n }], []);
    expect(result.mwr).toBeNull();
    expect(result.twr).toBe(0);
  });

  it("stores returns as basis points × 10⁴ and round-trips", () => {
    expect(returnToBpsE4(0.0341)).toBe(3_410_000n);
    expect(returnToBpsE4(-0.000001)).toBe(-100n);
    expect(bpsE4ToReturn(3_410_000n)).toBeCloseTo(0.0341, 12);
    expect(() => returnToBpsE4(Number.NaN)).toThrow(RangeError);
  });
});
