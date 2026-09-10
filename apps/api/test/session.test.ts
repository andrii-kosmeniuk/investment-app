import { describe, expect, it } from "vitest";
import { bearerToken, createSessionTokens } from "../src/auth/session.js";

const secret = "a-session-secret-that-is-definitely-32-chars";

describe("session tokens", () => {
  it("round-trips the customer id and expires exactly at TTL", async () => {
    const tokens = createSessionTokens({ secret, ttlSeconds: 60 });
    const issuedAt = new Date("2026-09-10T15:00:00Z");
    const session = await tokens.issue({ customerId: "cust-1" }, issuedAt);
    expect(session.expiresAt.toISOString()).toBe("2026-09-10T15:01:00.000Z");
    await expect(tokens.verify(session.token, new Date("2026-09-10T15:00:59Z"))).resolves.toEqual({ customerId: "cust-1" });
    // jose allows no clock skew when currentDate is supplied and exp has passed by > tolerance
    await expect(tokens.verify(session.token, new Date("2026-09-10T15:05:00Z"))).resolves.toBeNull();
  });

  it("rejects tokens signed with another secret or tampered with", async () => {
    const tokens = createSessionTokens({ secret, ttlSeconds: 60 });
    const other = createSessionTokens({ secret: "another-secret-that-is-also-32-chars-long", ttlSeconds: 60 });
    const session = await other.issue({ customerId: "cust-1" });
    await expect(tokens.verify(session.token)).resolves.toBeNull();
    const own = await tokens.issue({ customerId: "cust-1" });
    await expect(tokens.verify(`${own.token}x`)).resolves.toBeNull();
    await expect(tokens.verify("not.a.jwt")).resolves.toBeNull();
  });
});

describe("bearerToken", () => {
  it("extracts only well-formed bearer headers", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerToken("Bearer ")).toBeNull();
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});
