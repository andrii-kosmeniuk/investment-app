import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  activityResponse,
  confirmationRequiredResponse,
  investmentResponse,
  meResponse,
  modelsResponse,
  onboardingResponse,
  portfolioResponse,
  sessionResponse,
  transfersResponse,
  verificationSessionResponse,
} from "@corgi/contracts";
import { buildApi } from "../src/app.js";
import type { ApiServices } from "../src/services.js";
import {
  type FakeOptions,
  type FakeState,
  NOAH_ID,
  OLIVIA_ID,
  defaultState,
  fakeCustomerServices,
  testConfig,
} from "./customer-fakes.js";

const config = testConfig;

let app: FastifyInstance;
let state: FakeState;

async function start(options: FakeOptions = {}): Promise<void> {
  state = await defaultState();
  const customer = fakeCustomerServices(state, options);
  const services = { customer } as unknown as ApiServices;
  app = await buildApi({ ...config, NODE_ENV: "test" }, services);
  await app.ready();
}

async function tokenFor(email: string): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/v1/auth/sign-in", payload: { email, password: "corgi-demo-2026" } });
  expect(response.statusCode).toBe(200);
  return sessionResponse.parse(response.json()).token;
}

const authed = (token: string) => ({ authorization: `Bearer ${token}` });

beforeEach(() => start());
afterEach(() => app.close());

describe("sign-in", () => {
  it("issues a session for valid credentials and reports the customer", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/sign-in",
      payload: { email: "olivia@demo.corgi", password: "corgi-demo-2026" },
    });
    expect(response.statusCode).toBe(200);
    const body = sessionResponse.parse(response.json());
    expect(body.customer).toMatchObject({ id: OLIVIA_ID, displayName: "Olivia Martin", kycStatus: "approved" });
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.parse("2026-09-10T15:00:00Z"));
  });

  it("answers 401 with the same message for a wrong password and an unknown email", async () => {
    for (const payload of [
      { email: "olivia@demo.corgi", password: "wrong" },
      { email: "nobody@demo.corgi", password: "corgi-demo-2026" },
    ]) {
      const response = await app.inject({ method: "POST", url: "/v1/auth/sign-in", payload });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: "invalid_credentials" });
    }
  });

  it("rejects a malformed body with 400", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/auth/sign-in", payload: { email: "not-an-email" } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "invalid_request" });
  });
});

describe("sign-up (ADR-0006)", () => {
  const payload = { email: "  Ada.Lovelace@Example.com ", password: "long-enough-password", displayName: "  Ada   Lovelace " };

  it("creates a customer who can sign in but not yet fund or invest", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/auth/sign-up", payload });
    expect(response.statusCode).toBe(201);
    const body = sessionResponse.parse(response.json());
    expect(body.customer).toMatchObject({
      email: "ada.lovelace@example.com",
      displayName: "Ada Lovelace",
      kycStatus: "not_started",
      tradingBlocked: true,
    });

    const me = await app.inject({ method: "GET", url: "/v1/customer/me", headers: authed(body.token) });
    expect(me.statusCode).toBe(200);
    expect(meResponse.parse(me.json()).customer.id).toBe(body.customer.id);

    const onboarding = await app.inject({ method: "GET", url: "/v1/customer/onboarding", headers: authed(body.token) });
    expect(onboarding.statusCode).toBe(200);
    expect(onboarding.json().steps.map((step: { key: string; status: string }) => [step.key, step.status])).toEqual([
      ["account", "complete"],
      ["identity", "current"],
      ["bank", "upcoming"],
      ["deposit", "upcoming"],
      ["model", "upcoming"],
    ]);

    const deposit = await app.inject({
      method: "POST",
      url: "/v1/customer/transfers/deposits",
      headers: authed(body.token),
      payload: { amount: "100.00" },
    });
    expect(deposit.statusCode).toBeGreaterThanOrEqual(400);
    expect(deposit.statusCode).toBeLessThan(500);
  });

  it("lets the new customer sign in with the email as typed", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/auth/sign-up", payload })).statusCode).toBe(201);
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/sign-in",
      payload: { email: "Ada.Lovelace@Example.com", password: "long-enough-password" },
    });
    expect(response.statusCode).toBe(200);
  });

  it("answers 409 email_taken for an existing email, whatever the case", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/sign-up",
      payload: { ...payload, email: "OLIVIA@demo.corgi" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "email_taken" });
  });

  it("rejects short passwords and empty names with 400", async () => {
    for (const bad of [
      { ...payload, password: "short" },
      { ...payload, displayName: " " },
      { ...payload, email: "not-an-email" },
    ]) {
      const response = await app.inject({ method: "POST", url: "/v1/auth/sign-up", payload: bad });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: "invalid_request" });
    }
  });
});

describe("public model catalogue (ADR-0006)", () => {
  it("serves the configured models without a session", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/models" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { models: { code: string; allocations: { targetWeightBps: number }[] }[] };
    expect(body.models.length).toBeGreaterThan(0);
    for (const model of body.models) {
      expect(model.allocations.reduce((sum, leg) => sum + leg.targetWeightBps, 0)).toBe(10_000);
    }
  });
});

describe("session gate", () => {
  it("refuses every customer route without a valid bearer", async () => {
    for (const url of ["/v1/customer/me", "/v1/customer/portfolio", "/v1/customer/activity", "/v1/customer/transfers"]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url, headers: authed("garbage") })).statusCode).toBe(401);
    }
  });

  it("rejects a token signed with another secret", async () => {
    const { createSessionTokens } = await import("../src/auth/session.js");
    const forged = await createSessionTokens({ secret: "another-secret-that-is-also-32-chars-long", ttlSeconds: 3600 }).issue({ customerId: OLIVIA_ID });
    const response = await app.inject({ method: "GET", url: "/v1/customer/me", headers: authed(forged.token) });
    expect(response.statusCode).toBe(401);
  });

  it("returns the signed-in customer and the environment", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/customer/me", headers: authed(await tokenFor("olivia@demo.corgi")) });
    expect(response.statusCode).toBe(200);
    expect(meResponse.parse(response.json())).toMatchObject({ environment: "sandbox", customer: { email: "olivia@demo.corgi" } });
  });
});

describe("portfolio", () => {
  it("derives cash from the ledger, values positions, and validates against the contract", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/customer/portfolio", headers: authed(await tokenFor("olivia@demo.corgi")) });
    expect(response.statusCode).toBe(200);
    const body = portfolioResponse.parse(response.json());
    expect(body.asOf).toBe("2026-09-10");
    expect(body.cash).toEqual({
      settledCents: "100000",
      pendingDepositCents: "0",
      unsettledBuysCents: "59400",
      unsettledSellsCents: "0",
      availableToInvestCents: "40600",
      availableToWithdrawCents: "40600",
    });
    expect(body.positions).toEqual([
      {
        symbol: "VTI",
        unitsMicro: "2000000",
        price: { value: "297.005", asOfDate: "2026-09-10", status: "final" },
        valueCents: "59401",
        targetWeightBps: 6000,
        actualWeightBps: 5940,
      },
    ]);
    expect(body.value).toEqual({ cents: String(40_600 + 59_401), status: "final" });
    expect(body.model).toEqual({ code: "balanced-growth-v1", name: "Balanced growth" });
    expect(body.performance).toBeNull();
  });

  it("is an honest empty view for a customer with no ledger history", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/customer/portfolio", headers: authed(await tokenFor("noah@demo.corgi")) });
    const body = portfolioResponse.parse(response.json());
    expect(body.value).toEqual({ cents: "0", status: "final" });
    expect(body.positions).toEqual([]);
    expect(body.model).toBeNull();
  });

  it("does not report a value when a held position has no price", async () => {
    state.prices.rows.length = 0;
    const response = await app.inject({ method: "GET", url: "/v1/customer/portfolio", headers: authed(await tokenFor("olivia@demo.corgi")) });
    const body = portfolioResponse.parse(response.json());
    expect(body.value).toEqual({ cents: null, status: "unavailable" });
    expect(body.positions[0]).toMatchObject({ price: null, valueCents: null });
  });
});

describe("activity and transfers", () => {
  it("lists ledger entries newest first with every leg", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/customer/activity", headers: authed(await tokenFor("olivia@demo.corgi")) });
    const body = activityResponse.parse(response.json());
    expect(body.rows.map((row) => row.label)).toEqual(["Buy VTI", "Deposit settled", "Deposit initiated"]);
    expect(body.rows[0]?.amount).toEqual({ commodity: "VTI", quantity: "2000000" });
    expect(body.rows[0]?.legs).toHaveLength(4);
    expect(body.rows[2]?.legs[1]).toEqual({ accountPath: "firm:clearing:plaid-sweep", commodity: "USD", quantity: "-100000" });
  });

  it("builds the deposit timeline from ledger events, not the transfer row", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/customer/transfers", headers: authed(await tokenFor("olivia@demo.corgi")) });
    const body = transfersResponse.parse(response.json());
    expect(body.bankAccounts).toEqual([{ id: expect.any(String), institutionName: "Chase", accountMask: "4821", status: "active" }]);
    expect(body.transfers[0]).toMatchObject({
      amountCents: "100000",
      status: "settled", // row says "pending"; the ledger says settled
      bankAccount: { institutionName: "Chase" },
      timeline: [
        { step: "pending", state: "done", at: "2026-09-08T14:00:00.000Z" },
        { step: "settled", state: "done", at: "2026-09-09T14:00:00.000Z" },
      ],
    });
  });
});

describe("onboarding and verification", () => {
  it("shows Noah's rail stuck on identity with no start when nothing else is done", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/customer/onboarding", headers: authed(await tokenFor("noah@demo.corgi")) });
    const body = onboardingResponse.parse(response.json());
    expect(body.steps.map((step) => step.status)).toEqual(["complete", "current", "upcoming", "upcoming", "upcoming"]);
    expect(body.identity).toEqual({ status: "needs_review", inquiryId: null, canStart: true });
  });

  it("starts a verification session and records the inquiry", async () => {
    const token = await tokenFor("noah@demo.corgi");
    const response = await app.inject({ method: "POST", url: "/v1/customer/verification", headers: authed(token) });
    expect(response.statusCode).toBe(201);
    expect(verificationSessionResponse.parse(response.json())).toEqual({ inquiryId: "inq-1", sessionToken: "tok-1" });
    expect(state.inquiries).toHaveLength(1);
  });

  it("refuses verification for an approved customer", async () => {
    const response = await app.inject({ method: "POST", url: "/v1/customer/verification", headers: authed(await tokenFor("olivia@demo.corgi")) });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "not_permitted" });
  });

  it("answers 503 when the identity provider is not configured", async () => {
    await app.close();
    await start({ withIdentity: false });
    const response = await app.inject({ method: "POST", url: "/v1/customer/verification", headers: authed(await tokenFor("noah@demo.corgi")) });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "persona_not_configured" });
  });
});

describe("funding", () => {
  it("mints a Link token and stores a linked bank account", async () => {
    const token = await tokenFor("olivia@demo.corgi");
    const linkToken = await app.inject({ method: "POST", url: "/v1/customer/bank-accounts/link-token", headers: authed(token) });
    expect(linkToken.json()).toEqual({ linkToken: "link-sandbox-abc" });

    const linked = await app.inject({
      method: "POST",
      url: "/v1/customer/bank-accounts",
      headers: authed(token),
      payload: { publicToken: "public-xyz", accountId: "acct-2", institutionName: "Ally", accountMask: "1122" },
    });
    expect(linked.statusCode).toBe(201);
    expect(linked.json()).toMatchObject({ institutionName: "Ally", accountMask: "1122", status: "active" });
    expect(state.bankAccounts.at(-1)?.providerAccessToken).toBe("access-public-xyz");
    expect(JSON.stringify(linked.json())).not.toContain("access-"); // never leaks the token
  });

  it("creates a deposit from a human-typed amount using the stored bank credentials", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/customer/transfers/deposits",
      headers: authed(await tokenFor("olivia@demo.corgi")),
      payload: { bankAccountId: state.bankAccounts[0]?.id, amount: "$1,250.50" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ status: "initiated" });
    expect(state.deposits).toEqual([{ accessToken: "access-sandbox-1", amountCents: 125_050n }]);
    expect(state.transfers.at(-1)).toMatchObject({ amountCents: 125_050n, direction: "deposit" });
  });

  it("maps business-rule failures to 400/403/404", async () => {
    const token = await tokenFor("olivia@demo.corgi");
    const bankAccountId = state.bankAccounts[0]?.id;
    const tooBig = await app.inject({ method: "POST", url: "/v1/customer/transfers/deposits", headers: authed(token), payload: { bankAccountId, amount: "60000" } });
    expect(tooBig.statusCode).toBe(400);
    const unknownBank = await app.inject({
      method: "POST",
      url: "/v1/customer/transfers/deposits",
      headers: authed(token),
      payload: { bankAccountId: "00000000-0000-4000-8000-000000000999", amount: "100" },
    });
    expect(unknownBank.statusCode).toBe(404);
    const noah = await app.inject({
      method: "POST",
      url: "/v1/customer/transfers/deposits",
      headers: authed(await tokenFor("noah@demo.corgi")),
      payload: { bankAccountId, amount: "100" },
    });
    expect(noah.statusCode).toBe(403);
    expect(state.deposits).toHaveLength(0);
  });
});

describe("investing", () => {
  it("lists the model catalogue", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/customer/models", headers: authed(await tokenFor("olivia@demo.corgi")) });
    const body = modelsResponse.parse(response.json());
    expect(body.models[0]?.allocations.reduce((sum, allocation) => sum + allocation.targetWeightBps, 0)).toBe(10_000);
  });

  it("invests available cash into the chosen model and returns the legs", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/customer/portfolio/model",
      headers: authed(await tokenFor("olivia@demo.corgi")),
      payload: { modelCode: "balanced-growth-v1" },
    });
    expect(response.statusCode).toBe(201);
    const body = investmentResponse.parse(response.json());
    // available $406.00 − 1% = $401.94 → 60/19/21
    expect(body.legs).toEqual([
      { symbol: "VTI", notionalCents: "24116", status: "submitted" },
      { symbol: "VXUS", notionalCents: "7637", status: "submitted" },
      { symbol: "BND", notionalCents: "8441", status: "submitted" },
    ]);
    expect(state.submittedOrders).toHaveLength(3);
  });

  it("returns 409 confirmation_required with the legs when a leg crosses the threshold", async () => {
    state.entries = state.entries.filter((entry) => entry.kind !== "buy_fill");
    state.entries.push({
      ...state.entries[1]!,
      id: "44444444-4444-4444-8444-444444444444",
      idempotencyKey: "plaid:transfer.settled:xfer-9",
      sourceRef: "xfer-9",
      postings: state.entries[1]!.postings.map((posting) => ({ ...posting, quantity: posting.quantity * 2n })),
    });
    const token = await tokenFor("olivia@demo.corgi");
    const response = await app.inject({
      method: "POST",
      url: "/v1/customer/portfolio/model",
      headers: authed(token),
      payload: { modelCode: "balanced-growth-v1" },
    });
    expect(response.statusCode).toBe(409);
    const body = confirmationRequiredResponse.parse(response.json());
    expect(body.legs[0]).toEqual({ symbol: "VTI", notionalCents: "178200" }); // 60% of $2,970
    expect(state.submittedOrders).toHaveLength(0);

    const confirmed = await app.inject({
      method: "POST",
      url: "/v1/customer/portfolio/model",
      headers: authed(token),
      payload: { modelCode: "balanced-growth-v1", confirmed: true },
    });
    expect(confirmed.statusCode).toBe(201);
    expect(state.submittedOrders).toHaveLength(3);
    expect(state.approvals.requests).toHaveLength(0);
  });

  it("maps an unknown model to 404 and a blocked customer to 403", async () => {
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/customer/portfolio/model",
      headers: authed(await tokenFor("olivia@demo.corgi")),
      payload: { modelCode: "nope" },
    });
    expect(unknown.statusCode).toBe(404);
    const blocked = await app.inject({
      method: "POST",
      url: "/v1/customer/portfolio/model",
      headers: authed(await tokenFor("noah@demo.corgi")),
      payload: { modelCode: "balanced-growth-v1" },
    });
    expect(blocked.statusCode).toBe(403);
  });
});
