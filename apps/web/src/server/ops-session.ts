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
/**
 * Which human is acting. The token proves "an operator"; this names the one,
 * and the API sends it as `X-Operator-Id` so maker ≠ checker can be enforced
 * (ADR-0005). Chosen after the token is verified, from the API's actor list.
 */
export const OPS_OPERATOR_COOKIE = "corgi_ops_operator";
const OPS_SESSION_MS = 8 * 60 * 60 * 1000;

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/ops",
  expires: new Date(Date.now() + OPS_SESSION_MS),
});

export async function readOperatorToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(OPS_COOKIE)?.value ?? null;
}

export async function readOperatorId(): Promise<string | null> {
  const store = await cookies();
  return store.get(OPS_OPERATOR_COOKIE)?.value ?? null;
}

export async function writeOperatorCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(OPS_COOKIE, token, cookieOptions());
}

export async function writeOperatorIdCookie(operatorId: string): Promise<void> {
  const store = await cookies();
  store.set(OPS_OPERATOR_COOKIE, operatorId, cookieOptions());
}

export async function clearOperatorCookie(): Promise<void> {
  const store = await cookies();
  store.delete({ name: OPS_COOKIE, path: "/ops" });
  store.delete({ name: OPS_OPERATOR_COOKIE, path: "/ops" });
}

/** Client bound to the operator token (and acting operator, when chosen), or null when signed out. */
export async function opsApi(): Promise<ApiClient | null> {
  const token = await readOperatorToken();
  if (!token) return null;
  return createApiClient({ baseUrl: apiBaseUrl(), token, operatorId: await readOperatorId() });
}
