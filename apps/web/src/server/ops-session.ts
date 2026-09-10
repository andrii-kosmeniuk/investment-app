import { cookies } from "next/headers";
import { createApiClient, type ApiClient } from "./api-client";
import { apiBaseUrl } from "./api";

/**
 * Operator access to the live-fire console. The web server never holds the
 * operator token itself: the operator presents it once, we verify it against
 * the API, and keep it only in an httpOnly cookie for that browser (8 hours).
 * Losing the cookie costs nothing; rotating LIVE_FIRE_TOKEN on the API revokes
 * every operator at once (ADR-0004).
 */
export const OPS_COOKIE = "corgi_ops";
const OPS_SESSION_MS = 8 * 60 * 60 * 1000;

export async function readOperatorToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(OPS_COOKIE)?.value ?? null;
}

export async function writeOperatorCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(OPS_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/ops",
    expires: new Date(Date.now() + OPS_SESSION_MS),
  });
}

export async function clearOperatorCookie(): Promise<void> {
  const store = await cookies();
  store.delete({ name: OPS_COOKIE, path: "/ops" });
}

/** Client bound to the operator token, or null when no operator is signed in. */
export async function opsApi(): Promise<ApiClient | null> {
  const token = await readOperatorToken();
  return token ? createApiClient({ baseUrl: apiBaseUrl(), token }) : null;
}
