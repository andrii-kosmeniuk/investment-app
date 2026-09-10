import { afterEach, describe, expect, it, vi } from "vitest";
import { AlpacaBrokerAdapter } from "../src/index.js";

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
