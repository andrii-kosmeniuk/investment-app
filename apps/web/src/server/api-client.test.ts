import { describe, expect, it } from "vitest";
import { ApiClientError, createApiClient } from "./api-client";

interface Captured {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string | undefined;
}

function fakeFetch(status: number, payload: unknown, captured: Captured[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(input),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(payload === undefined ? "" : JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const ME = {
  customer: {
    id: "0a3f4b6e-6a1b-4a9e-9d2f-1c5a7b8e9f01",
    email: "olivia@example.com",
    displayName: "Olivia Chen",
    kycStatus: "approved",
    tradingBlocked: false,
  },
  environment: "sandbox",
};

describe("createApiClient", () => {
  it("sends the bearer token and validates the response against the contract", async () => {
    const captured: Captured[] = [];
    const api = createApiClient({ baseUrl: "https://api.test", token: "tok", fetch: fakeFetch(200, ME, captured) });
    const me = await api.me();
    expect(me.customer.displayName).toBe("Olivia Chen");
    expect(captured[0]).toMatchObject({ url: "https://api.test/v1/customer/me", method: "GET" });
    expect(captured[0]?.headers.authorization).toBe("Bearer tok");
    expect(captured[0]?.body).toBeUndefined();
  });

  it("posts JSON bodies and omits the authorization header when anonymous", async () => {
    const captured: Captured[] = [];
    const session = { token: "t", expiresAt: "2026-09-10T12:00:00.000Z", customer: ME.customer };
    const api = createApiClient({ baseUrl: "https://api.test", fetch: fakeFetch(200, session, captured) });
    await api.signIn("olivia@example.com", "pw");
    expect(captured[0]?.headers["content-type"]).toBe("application/json");
    expect(captured[0]?.headers.authorization).toBeUndefined();
    expect(JSON.parse(captured[0]?.body ?? "{}")).toEqual({ email: "olivia@example.com", password: "pw" });
  });

  it("surfaces the server's error code and message on non-2xx answers", async () => {
    const api = createApiClient({ baseUrl: "https://api.test", token: "t", fetch: fakeFetch(401, { error: "unauthorized", message: "Session expired" }) });
    const error = await api.me().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ status: 401, code: "unauthorized", message: "Session expired" });
  });

  it("exposes confirmation legs from a 409 confirmation_required answer", async () => {
    const body = {
      error: "confirmation_required",
      message: "Confirm",
      legs: [{ symbol: "VTI", notionalCents: "150000", status: "submitted" }],
    };
    const api = createApiClient({ baseUrl: "https://api.test", token: "t", fetch: fakeFetch(409, body) });
    const error = (await api.chooseModel("balanced-v1", false).catch((e: unknown) => e)) as ApiClientError;
    expect(error.confirmation?.legs[0]?.notionalCents).toBe("150000");
  });

  it("fails loudly when the server shape drifts from the contract", async () => {
    const api = createApiClient({ baseUrl: "https://api.test", token: "t", fetch: fakeFetch(200, { customer: { id: 1 } }) });
    await expect(api.me()).rejects.toMatchObject({ code: "contract_mismatch" });
  });

  it("reports unreachable APIs as a network error, not a crash", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const api = createApiClient({ baseUrl: "https://api.test", token: "t", fetch: failing });
    await expect(api.me()).rejects.toMatchObject({ status: 0, code: "network_error" });
  });
});
