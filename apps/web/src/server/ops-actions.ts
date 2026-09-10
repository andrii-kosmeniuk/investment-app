"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { LiveFireResponse } from "@corgi/contracts";
import { type ActionResult } from "./actions";
import { ApiClientError, createApiClient } from "./api-client";
import { apiBaseUrl } from "./api";
import { clearOperatorCookie, opsApi, writeOperatorCookie } from "./ops-session";

const fail = <T,>(error: unknown): ActionResult<T> => {
  if (error instanceof ApiClientError) {
    if (error.status === 503) return { ok: false, error: "The live-fire console is switched off in this environment (LIVE_FIRE_TOKEN is not set on the API).", code: error.code, data: null };
    if (error.status === 401) return { ok: false, error: "Operator token was not accepted.", code: error.code, data: null };
    return { ok: false, error: error.message, code: error.code, data: null };
  }
  return { ok: false, error: "Something went wrong on our side. Nothing was changed.", code: "unknown", data: null };
};

export async function opsSignInAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const token = String(formData.get("token") ?? "").trim();
  if (token.length < 24) return { ok: false, error: "Enter the operator token.", code: "invalid_request", data: null };
  try {
    // Verify before storing: a wrong token never becomes a cookie.
    await createApiClient({ baseUrl: apiBaseUrl(), token }).restatements();
    await writeOperatorCookie(token);
  } catch (error) {
    return fail(error);
  }
  redirect("/ops/live-fire");
}

export async function opsSignOutAction(): Promise<void> {
  await clearOperatorCookie();
  redirect("/ops");
}

export type LiveFireAction = LiveFireResponse["action"];

const field = (formData: FormData, name: string): string => String(formData.get(name) ?? "").trim();
const optional = (value: string): string | undefined => (value === "" ? undefined : value);

/**
 * One server action for the whole console; the `action` field says which
 * scenario to fire. Bodies are passed through as the operator typed them — the
 * API validates against `@corgi/contracts` and answers with the real
 * restatement summary, which the console shows verbatim.
 */
export async function liveFireAction(_previous: ActionResult<LiveFireResponse> | null, formData: FormData): Promise<ActionResult<LiveFireResponse>> {
  const api = await opsApi();
  if (!api) return { ok: false, error: "Operator session expired. Sign in again.", code: "unauthorized", data: null };
  const action = field(formData, "action") as LiveFireAction;
  try {
    let result: LiveFireResponse;
    switch (action) {
      case "corrected_close":
        result = await api.correctedClose({ symbol: field(formData, "symbol"), tradeDate: field(formData, "tradeDate"), close: field(formData, "close") });
        break;
      case "late_dividend":
        result = await api.lateDividend({
          customerId: field(formData, "customerId"),
          symbol: field(formData, "symbol"),
          exDate: field(formData, "exDate"),
          payDate: field(formData, "payDate"),
          amountCents: field(formData, "amountCents"),
        });
        break;
      case "stock_split":
        result = await api.stockSplit({
          customerId: field(formData, "customerId"),
          symbol: field(formData, "symbol"),
          numerator: field(formData, "numerator"),
          denominator: field(formData, "denominator"),
          effectiveDate: field(formData, "effectiveDate"),
        });
        break;
      case "run_valuation": {
        const customerId = optional(field(formData, "customerId"));
        result = await api.runValuation({ from: field(formData, "from"), to: field(formData, "to"), ...(customerId ? { customerId } : {}) });
        break;
      }
      case "collect_closes":
        result = await api.collectCloses({ from: field(formData, "from"), to: field(formData, "to") });
        break;
      default:
        return { ok: false, error: "Unknown live-fire action.", code: "invalid_request", data: null };
    }
    revalidatePath("/ops/restatements");
    revalidatePath("/performance");
    revalidatePath("/portfolio");
    revalidatePath("/overview");
    return { ok: true, error: null, code: null, data: result };
  } catch (error) {
    return fail(error);
  }
}
