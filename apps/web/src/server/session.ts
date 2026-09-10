import { cookies } from "next/headers";

/**
 * The API mints the session token; the web app only stores it. httpOnly so the
 * browser never reads it, `secure` outside development, and expiry pinned to
 * the token's own expiry so the cookie cannot outlive the session.
 */
export const SESSION_COOKIE = "corgi_session";

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function writeSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
