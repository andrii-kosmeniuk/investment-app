import type { ActionResult } from "./actions";
import { ApiClientError } from "./api-client";

/** Turns an API failure into the honest sentence an operator should read. Nothing was changed. */
export function opsFailure<T>(error: unknown): ActionResult<T> {
  if (error instanceof ApiClientError) {
    if (error.status === 503) return { ok: false, error: "The operations console is switched off in this environment (LIVE_FIRE_TOKEN is not set on the API).", code: error.code, data: null };
    if (error.status === 401) return { ok: false, error: "Operator token was not accepted.", code: error.code, data: null };
    if (error.code === "operator_required") return { ok: false, error: "Choose who you are acting as first (left column).", code: error.code, data: null };
    return { ok: false, error: error.message, code: error.code, data: null };
  }
  return { ok: false, error: "Something went wrong on our side. Nothing was changed.", code: "unknown", data: null };
}

export const formField = (formData: FormData, name: string): string => String(formData.get(name) ?? "").trim();
export const optionalField = (value: string): string | undefined => (value === "" ? undefined : value);
