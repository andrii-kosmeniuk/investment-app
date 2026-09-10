import { afterEach, describe, expect, it, vi } from "vitest";
import { PlaidFundingAdapter, formatCents } from "../src/index.js";

describe("formatCents", () => {
  it("renders integer cents as a two-place decimal without floats", () => {
    expect(formatCents(100_000n)).toBe("1000.00");
    expect(formatCents(5n)).toBe("0.05");
    expect(formatCents(123_456_789_012_345n)).toBe("1234567890123.45");
    expect(formatCents(-250n)).toBe("-2.50");
  });
});

describe("PlaidFundingAdapter.createDeposit", () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const respond = (path: string) => {
    if (path.endsWith("/transfer/authorization/create")) {
      return { authorization: { id: "auth-1", decision: "approved" } };
    }
    if (path.endsWith("/transfer/create")) return { transfer: { id: "xfer-1", status: "pending" } };
    if (path.endsWith("/item/public_token/exchange")) return { access_token: "access-1", item_id: "item-1" };
    throw new Error(`unexpected path ${path}`);
  };

  afterEach(() => {
    calls.length = 0;
    vi.unstubAllGlobals();
  });

  function stubFetch(override?: (path: string) => unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string, init?: RequestInit) => {
        const path = new URL(String(url)).pathname;
        calls.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        return new Response(JSON.stringify((override ?? respond)(path)), { status: 200 });
      }),
    );
  }

  const adapter = () =>
    new PlaidFundingAdapter({ baseUrl: "https://sandbox.plaid.com", clientId: "cid", secret: "sec" });

  it("authorizes with the idempotency key, then creates against the authorization id", async () => {
    stubFetch();
    const result = await adapter().createDeposit({
      customerId: "cust-1",
      accessToken: "access-1",
      providerAccountId: "acct-1",
      amountCents: 100_000n,
      idempotencyKey: "idem-1",
    });
    expect(result).toEqual({ transferId: "xfer-1", status: "pending" });
    expect(calls.map((call) => call.path)).toEqual(["/transfer/authorization/create", "/transfer/create"]);
    expect(calls[0]?.body).toMatchObject({
      client_id: "cid",
      secret: "sec",
      access_token: "access-1",
      account_id: "acct-1",
      idempotency_key: "idem-1",
      amount: "1000.00",
      type: "debit",
      network: "ach",
    });
    expect(calls[1]?.body).toMatchObject({ access_token: "access-1", account_id: "acct-1", authorization_id: "auth-1" });
  });

  it("stops after a declined authorization and never creates the transfer", async () => {
    stubFetch((path) =>
      path.endsWith("/transfer/authorization/create")
        ? { authorization: { id: "auth-2", decision: "declined", decision_rationale: { code: "NSF", description: "NSF" } } }
        : respond(path),
    );
    await expect(
      adapter().createDeposit({
        customerId: "cust-1",
        accessToken: "access-1",
        providerAccountId: "acct-1",
        amountCents: 100n,
        idempotencyKey: "idem-2",
      }),
    ).rejects.toMatchObject({ name: "DepositDeclinedError", code: "NSF", message: /declined.*NSF/ });
    expect(calls.map((call) => call.path)).toEqual(["/transfer/authorization/create"]);
  });

  it("exchanges a public token for item credentials", async () => {
    stubFetch();
    await expect(adapter().exchangePublicToken("public-1")).resolves.toEqual({ accessToken: "access-1", itemId: "item-1" });
    expect(calls[0]?.body).toMatchObject({ public_token: "public-1" });
  });
});
