import { afterEach, describe, expect, it, vi } from "vitest";
import { AlpacaBrokerAdapter, sandboxAccountApplication, sandboxTaxId } from "../src/index.js";

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

  it("falls back to the pre-provisioned sandbox account only on a 403", async () => {
    stubFetch(403, { code: 40310000, message: "request is forbidden" });
    const adapter = new AlpacaBrokerAdapter({ ...config, sandboxAccountId: "sandbox-acct" });
    await expect(adapter.createAccount("cust-1")).resolves.toEqual({
      accountId: "sandbox-acct",
      status: "ACTIVE",
    });
  });

  it("surfaces the provider error when no sandbox account is configured", async () => {
    stubFetch(403, { code: 40310000, message: "request is forbidden" });
    const adapter = new AlpacaBrokerAdapter(config);
    await expect(adapter.createAccount("cust-1")).rejects.toMatchObject({
      name: "ProviderHttpError",
      status: 403,
    });
  });

  it("does not mask other failures behind the sandbox account", async () => {
    stubFetch(500, { message: "boom" });
    const adapter = new AlpacaBrokerAdapter({ ...config, sandboxAccountId: "sandbox-acct" });
    await expect(adapter.createAccount("cust-1")).rejects.toMatchObject({ status: 500 });
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
