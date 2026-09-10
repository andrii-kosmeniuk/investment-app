import { redirect } from "next/navigation";
import { ApiClientError, createApiClient, type ApiClient } from "./api-client";
import { readSessionToken } from "./session";

/** Server-only. Missing at build time is fine; missing at request time is a configuration error. */
export function apiBaseUrl(): string {
  const url = process.env.API_BASE_URL;
  if (!url) throw new Error("API_BASE_URL is not configured for the web app");
  return url;
}

export function anonymousApi(): ApiClient {
  return createApiClient({ baseUrl: apiBaseUrl() });
}

/** Client bound to the current session cookie, or null when signed out. */
export async function sessionApi(): Promise<ApiClient | null> {
  const token = await readSessionToken();
  return token ? createApiClient({ baseUrl: apiBaseUrl(), token }) : null;
}

/** For pages inside the signed-in shell: redirects to sign-in when there is no session. */
export async function requireApi(): Promise<ApiClient> {
  const api = await sessionApi();
  if (!api) redirect("/sign-in");
  return api;
}

/**
 * Wraps a page's data load so an expired session sends the customer to sign in
 * while every other failure is returned for the page to render honestly.
 */
export async function load<T>(operation: () => Promise<T>): Promise<{ data: T; error: null } | { data: null; error: ApiClientError }> {
  try {
    return { data: await operation(), error: null };
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.status === 401) redirect("/sign-in?reason=expired");
      return { data: null, error };
    }
    throw error;
  }
}
