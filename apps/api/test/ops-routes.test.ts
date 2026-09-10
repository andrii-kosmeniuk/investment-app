import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { liveFireResponse, portfolioResponse, restatementsResponse, sessionResponse, statementResponse } from "@corgi/contracts";
import { buildApi } from "../src/app.js";
import type { ApiServices } from "../src/services.js";
import { type FakeOptions, type FakeState, LIVE_FIRE_TOKEN, OLIVIA_ID, defaultState, fakeCustomerServices, testConfig } from "./customer-fakes.js";

let app: FastifyInstance;
let state: FakeState;

async function start(options: FakeOptions = {}): Promise<void> {
  state = await defaultState();
  // A close for the day Olivia funded and bought, so Sep 9 can be valued too.
  await state.prices.record([{ symbol: "VTI", tradeDate: "2026-09-09", price: "297.00000000", source: "test" }], new Date("2026-09-09T20:15:00Z"));
  app = await buildApi(testConfig, { customer: fakeCustomerServices(state, options) } as unknown as ApiServices);
  await app.ready();
}

const ops = { authorization: `Bearer ${LIVE_FIRE_TOKEN}` };

async function customerToken(): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/v1/auth/sign-in", payload: { email: "olivia@demo.corgi", password: "corgi-demo-2026" } });
  return sessionResponse.parse(response.json()).token;
}

async function runValuation(from: string, to: string) {
  const response = await app.inject({ method: "POST", url: "/v1/ops/live-fire/run-valuation", headers: ops, payload: { from, to } });
  expect(response.statusCode).toBe(200);
  return liveFireResponse.parse(response.json());
}

afterEach(() => app.close());

describe("ops routes — access", () => {
  it("answers 503 when no operator token is configured", async () => {
    await start({ liveFireToken: null });
    const response = await app.inject({ method: "GET", url: "/v1/ops/restatements", headers: ops });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "live_fire_not_configured" });
  });

  it("rejects a missing or wrong operator token, and never accepts a customer session", async () => {
    await start();
    expect((await app.inject({ method: "GET", url: "/v1/ops/restatements" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/ops/restatements", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    const session = await customerToken();
    expect((await app.inject({ method: "GET", url: "/v1/ops/restatements", headers: { authorization: `Bearer ${session}` } })).statusCode).toBe(401);
  });
});

describe("live-fire console", () => {
  beforeEach(() => start());

  it("values a window on demand and the customer sees performance with no restatement", async () => {
    const run = await runValuation("2026-09-09", "2026-09-10");
    expect(run.summary).toMatchObject({ recorded: 2, unchanged: 0, unavailable: 0, empty: 2 }); // Noah has nothing to value yet

    const response = await app.inject({ method: "GET", url: "/v1/customer/portfolio", headers: { authorization: `Bearer ${await customerToken()}` } });
    const body = portfolioResponse.parse(response.json());
    expect(body.performance).toMatchObject({ asOfDate: "2026-09-10", valueCents: "100001", status: "final", version: 1, restated: null });
    const inception = body.performance!.returns.find((r) => r.period === "inception")!;
    expect(inception.periodStart).toBe("2026-09-09");
    expect(inception.twr).toBeCloseTo(100_001 / 100_000 - 1, 8);
    expect(inception.flowsCents).toBe("100000");
    expect(inception.restated).toBeNull();
  });

  it("corrected close → restated pill on the customer's return, old figure still served as published", async () => {
    await runValuation("2026-09-09", "2026-09-10");
    state.now = new Date("2026-09-11T14:00:00Z");

    const fire = await app.inject({
      method: "POST",
      url: "/v1/ops/live-fire/corrected-close",
      headers: ops,
      payload: { symbol: "vti", tradeDate: "2026-09-09", close: "296" },
    });
    expect(fire.statusCode).toBe(200);
    const result = liveFireResponse.parse(fire.json());
    expect(result.summary).toMatchObject({ symbol: "VTI", priceVersion: 2, changed: true, customersRestated: 1 });
    expect(result.restatements[0]).toMatchObject({
      customerId: OLIVIA_ID,
      fromDate: "2026-09-09",
      reason: "corrected_close:VTI@2026-09-09",
      dates: ["2026-09-09", "2026-09-10"],
      valuationsRewritten: 1,
      // Sep 9's own returns move too (Dietz on a lower closing value), then Sep 10's three.
      returnsRewritten: 6,
    });

    const token = await customerToken();
    const portfolio = portfolioResponse.parse((await app.inject({ method: "GET", url: "/v1/customer/portfolio", headers: { authorization: `Bearer ${token}` } })).json());
    const inception = portfolio.performance!.returns.find((r) => r.period === "inception")!;
    expect(inception.version).toBe(2);
    expect(inception.twr).toBeCloseTo(100_001 / 99_800 - 1, 8);
    expect(inception.restated?.previous).toBeCloseTo(100_001 / 100_000 - 1, 8);
    expect(inception.restated?.reason).toBe("corrected_close:VTI@2026-09-09");
    expect(inception.restated?.at).toBe("2026-09-11T14:00:00.000Z");

    // Statement toggle: as published on Sep 10 there was nothing to restate.
    const published = statementResponse.parse(
      (await app.inject({ method: "GET", url: "/v1/customer/statement?asPublishedOn=2026-09-10", headers: { authorization: `Bearer ${token}` } })).json(),
    );
    expect(published.asPublishedOn).toBe("2026-09-10");
    expect(published.series.find((v) => v.asOfDate === "2026-09-09")).toMatchObject({ valueCents: "100000", version: 1 });
    expect(published.performance!.returns.find((r) => r.period === "inception")).toMatchObject({ version: 1, restated: null });
    expect(published.restatements).toEqual([]);

    const current = statementResponse.parse((await app.inject({ method: "GET", url: "/v1/customer/statement", headers: { authorization: `Bearer ${token}` } })).json());
    expect(current.asPublishedOn).toBeNull();
    expect(current.series.find((v) => v.asOfDate === "2026-09-09")).toMatchObject({ valueCents: "99800", version: 2, reason: "corrected_close:VTI@2026-09-09" });
    expect(current.restatements).toHaveLength(7); // one valuation + two days × mtd/ytd/inception
    expect(current.restatements.find((r) => r.kind === "valuation")).toMatchObject({ asOfDate: "2026-09-09", from: "100000", to: "99800" });

    const audit = restatementsResponse.parse((await app.inject({ method: "GET", url: "/v1/ops/restatements", headers: ops })).json());
    expect(audit.rows).toHaveLength(7);
    expect(audit.rows.every((row) => row.customerId === OLIVIA_ID)).toBe(true);

    const rejected = await app.inject({ method: "GET", url: "/v1/customer/statement?asPublishedOn=yesterday", headers: { authorization: `Bearer ${token}` } });
    expect(rejected.statusCode).toBe(400);
  });

  it("late dividend → booked on the ex-date, valuation restated, dividend not a flow", async () => {
    await runValuation("2026-09-09", "2026-09-10");
    state.now = new Date("2026-09-11T14:00:00Z");
    const fire = await app.inject({
      method: "POST",
      url: "/v1/ops/live-fire/late-dividend",
      headers: ops,
      payload: { customerId: OLIVIA_ID, symbol: "VTI", exDate: "2026-09-09", payDate: "2026-09-10", amountCents: "150" },
    });
    expect(fire.statusCode).toBe(200);
    const result = liveFireResponse.parse(fire.json());
    expect(result.summary).toMatchObject({ entitlement: "inserted", payment: "inserted" });
    expect(result.restatements[0]).toMatchObject({ reason: "late_dividend:VTI@2026-09-09", valuationsRewritten: 2 });

    const statement = statementResponse.parse(
      (await app.inject({ method: "GET", url: "/v1/customer/statement", headers: { authorization: `Bearer ${await customerToken()}` } })).json(),
    );
    expect(statement.series.map((v) => [v.asOfDate, v.valueCents, v.version])).toEqual([
      ["2026-09-09", "100150", 2],
      ["2026-09-10", "100151", 2],
    ]);
    expect(statement.performance!.returns.find((r) => r.period === "inception")!.flowsCents).toBe("100000");
  });

  it("2-for-1 split → units double, value identical to the cent, no customer-facing restatement", async () => {
    await runValuation("2026-09-09", "2026-09-10");
    state.now = new Date("2026-09-11T14:00:00Z");
    const fire = await app.inject({
      method: "POST",
      url: "/v1/ops/live-fire/stock-split",
      headers: ops,
      payload: { customerId: OLIVIA_ID, symbol: "VTI", numerator: "2", denominator: "1", effectiveDate: "2026-09-10" },
    });
    expect(fire.statusCode).toBe(200);
    const result = liveFireResponse.parse(fire.json());
    expect(result.summary).toMatchObject({
      entry: "inserted",
      unitsBefore: "2000000",
      unitsAfter: "4000000",
      lotsAdjusted: 1,
      pricesAdjusted: 1,
      valueBeforeCents: "100001",
      valueAfterCents: "100001",
      valueUnchanged: true,
    });
    expect(state.adjustments[0]).toMatchObject({ unitsAfter: 4_000_000n, basisPerUnitAfter: "148.500000000000" });

    const portfolio = portfolioResponse.parse(
      (await app.inject({ method: "GET", url: "/v1/customer/portfolio", headers: { authorization: `Bearer ${await customerToken()}` } })).json(),
    );
    expect(portfolio.positions[0]).toMatchObject({ unitsMicro: "4000000", price: { value: "148.50250000" }, valueCents: "59401" });
    expect(portfolio.performance!.restated).toBeNull();
    expect(portfolio.performance!.returns.every((r) => r.restated === null)).toBe(true);
  });

  it("collects closes from the feed and restates when the feed corrects one; 503 without market data", async () => {
    await runValuation("2026-09-09", "2026-09-10");
    state.now = new Date("2026-09-11T14:00:00Z");
    state.marketCloses = [
      { symbol: "VTI", tradeDate: "2026-09-09", price: "297.00000000", source: "alpaca-iex" }, // unchanged
      { symbol: "VTI", tradeDate: "2026-09-10", price: "298.00000000", source: "alpaca-iex" }, // corrected
    ];
    const fire = await app.inject({ method: "POST", url: "/v1/ops/live-fire/collect-closes", headers: ops, payload: { from: "2026-09-09", to: "2026-09-10" } });
    expect(fire.statusCode).toBe(200);
    const result = liveFireResponse.parse(fire.json());
    expect(result.summary).toMatchObject({ recorded: 1, corrections: 1, customersRestated: 1 });
    expect(result.restatements[0]).toMatchObject({ fromDate: "2026-09-10", valuationsRewritten: 1 });

    await app.close();
    await start({ withMarketData: false });
    const missing = await app.inject({ method: "POST", url: "/v1/ops/live-fire/collect-closes", headers: ops, payload: { from: "2026-09-09", to: "2026-09-10" } });
    expect(missing.statusCode).toBe(503);
    expect(missing.json()).toMatchObject({ error: "alpaca_market_data_not_configured" });
  });

  it("validates live-fire payloads", async () => {
    const bad = await app.inject({ method: "POST", url: "/v1/ops/live-fire/corrected-close", headers: ops, payload: { symbol: "VTI", tradeDate: "09/09/2026", close: "abc" } });
    expect(bad.statusCode).toBe(400);
    const inverted = await app.inject({ method: "POST", url: "/v1/ops/live-fire/run-valuation", headers: ops, payload: { from: "2026-09-10", to: "2026-09-09" } });
    expect(inverted.statusCode).toBe(400);
    const noHolding = await app.inject({
      method: "POST",
      url: "/v1/ops/live-fire/stock-split",
      headers: ops,
      payload: { customerId: OLIVIA_ID, symbol: "BND", numerator: "2", denominator: "1", effectiveDate: "2026-09-10" },
    });
    expect(noHolding.statusCode).toBe(400);
    expect(noHolding.json()).toMatchObject({ error: "invalid_request" });
  });
});
