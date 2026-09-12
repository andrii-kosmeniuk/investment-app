import { afterEach, describe, expect, it, vi } from "vitest";
import { AlpacaBrokerAdapter, PlaidFundingAdapter, sandboxAccountApplication, sandboxTaxId } from "../src/index.js";

describe("PlaidFundingAdapter sandbox settlement (ADR-0008)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("only simulates against the sandbox host and sends Plaid's simulate body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ request_id: "r" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const sandbox = new PlaidFundingAdapter({ baseUrl: "https://sandbox.plaid.com", clientId: "c", secret: "s" });
    expect(sandbox.isSandbox).toBe(true);
    await sandbox.simulateTransferEvent("tr-1", "posted");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://sandbox.plaid.com/sandbox/transfer/simulate");
    expect(JSON.parse(String(init.body))).toMatchObject({ transfer_id: "tr-1", event_type: "posted", client_id: "c" });

    const production = new PlaidFundingAdapter({ baseUrl: "https://production.plaid.com", clientId: "c", secret: "s" });
    expect(production.isSandbox).toBe(false);
    await expect(production.simulateTransferEvent("tr-1", "posted")).rejects.toThrow(/sandbox/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("AlpacaBrokerAdapter.createAccount", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const config = { baseUrl: "https://broker.test", key: "k", secret: "s" };

  it("returns the account Alpaca opened", async () => {
    stubFetch(200, { id: "acct-1", status: "SUBMITTED" });
    const adapter = new AlpacaBrokerAdapter(config);
    await expect(adapter.createAccount("cust-1")).resolves.toEqual({
      accountId: "acct-1",
      status: "SUBMITTED",
    });
  });

  it("uses the pre-provisioned sandbox account without calling Alpaca when one is configured", async () => {
    // ASSUMPTIONS "sandbox identity": every customer trades on the one funded
    // dashboard account, so no per-customer application is ever sent.
    const fetchMock = stubFetch(500, { message: "must not be called" });
    const adapter = new AlpacaBrokerAdapter({ ...config, sandboxAccountId: "sandbox-acct" });
    await expect(adapter.createAccount("cust-1")).resolves.toEqual({
      accountId: "sandbox-acct",
      status: "ACTIVE",
    });
    await expect(adapter.ensureAccount("cust-1", "some-other-acct")).resolves.toEqual({
      accountId: "sandbox-acct",
      status: "ACTIVE",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces the provider error when no sandbox account is configured", async () => {
    stubFetch(403, { code: 40310000, message: "request is forbidden" });
    const adapter = new AlpacaBrokerAdapter(config);
    await expect(adapter.createAccount("cust-1")).rejects.toMatchObject({
      name: "ProviderHttpError",
      status: 403,
    });
  });

  it("surfaces a 5xx with its status so the application can tell an outage from a rejection", async () => {
    stubFetch(500, { code: 50010000, message: "internal server error occurred" });
    const adapter = new AlpacaBrokerAdapter(config);
    await expect(adapter.createAccount("cust-1")).rejects.toMatchObject({ name: "ProviderHttpError", status: 500 });
  });

  it("submitNotionalOrder surfaces Alpaca's 500 (sandbox code 50010000) with the status attached", async () => {
    stubFetch(500, { code: 50010000, message: "internal server error occurred" });
    const adapter = new AlpacaBrokerAdapter({ ...config, sandboxAccountId: "sandbox-acct" });
    await expect(
      adapter.submitNotionalOrder({ accountId: "sandbox-acct", clientOrderId: "c-1", symbol: "VTI", notionalCents: 100n, side: "buy" }),
    ).rejects.toMatchObject({ name: "ProviderHttpError", status: 500 });
  });
});

describe("sandboxAccountApplication", () => {
  it("derives a stable, format-valid tax id per customer", () => {
    const ids = ["a428b39f-5a4e-4f9a-83e0-65b25a4af886", "00000000-0000-0000-0000-000000000000", "noah"];
    for (const id of ids) {
      const taxId = sandboxTaxId(id);
      expect(taxId).toBe(sandboxTaxId(id));
      expect(taxId).toMatch(/^\d{3}-\d{2}-\d{4}$/);
      const [area, group, serial] = taxId.split("-") as [string, string, string];
      expect(area).not.toBe("000");
      expect(area).not.toBe("666");
      expect(area.startsWith("9")).toBe(false);
      expect(group).not.toBe("00");
      expect(serial).not.toBe("0000");
    }
    expect(sandboxTaxId(ids[0]!)).not.toBe(sandboxTaxId(ids[1]!));
  });

  it("sends every field Alpaca requires for a fully-disclosed sandbox account", () => {
    const application = sandboxAccountApplication("cust-1", new Date("2026-09-11T07:00:00Z"));
    expect(application.contact.email_address).toBe("corgi+cust-1@example.com");
    expect(application.identity.tax_id_type).toBe("USA_SSN");
    expect(application.agreements[0]).toEqual({
      agreement: "customer_agreement",
      signed_at: "2026-09-11T07:00:00.000Z",
      ip_address: "127.0.0.1",
    });
    expect(application.enabled_assets).toEqual(["us_equity"]);
  });
});
