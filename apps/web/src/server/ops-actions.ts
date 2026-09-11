"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { GenerateCustodianFileRequest, LiveFireResponse } from "@corgi/contracts";
import { type ActionResult } from "./actions";
import { createApiClient } from "./api-client";
import { apiBaseUrl } from "./api";
import { formField as field, opsFailure as fail, optionalField as optional } from "./ops-errors";
import { clearOperatorCookie, opsApi, writeOperatorCookie, writeOperatorIdCookie } from "./ops-session";

export async function opsSignInAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const token = String(formData.get("token") ?? "").trim();
  if (token.length < 24) return { ok: false, error: "Enter the operator token.", code: "invalid_request", data: null };
  try {
    // Verify before storing: a wrong token never becomes a cookie.
    await createApiClient({ baseUrl: apiBaseUrl(), token }).operators();
    await writeOperatorCookie(token);
  } catch (error) {
    return fail(error);
  }
  redirect("/ops");
}

/** Names the acting human. Only ids the API listed are accepted, so the cookie can't invent an operator. */
export async function chooseOperatorAction(formData: FormData): Promise<void> {
  const api = await opsApi();
  const operatorId = field(formData, "operatorId");
  if (!api || !operatorId) return;
  const { operators } = await api.operators();
  if (operators.some((operator) => operator.id === operatorId)) await writeOperatorIdCookie(operatorId);
  revalidatePath("/ops", "layout");
}

export async function opsSignOutAction(): Promise<void> {
  await clearOperatorCookie();
  redirect("/ops");
}

export type LiveFireAction = LiveFireResponse["action"];

function tamperFrom(formData: FormData): GenerateCustodianFileRequest["tamper"] {
  const kind = field(formData, "tamperKind");
  const customerId = field(formData, "customerId");
  switch (kind) {
    case "position":
      return { kind, customerId, symbol: field(formData, "symbol"), deltaUnitsMicro: field(formData, "delta") };
    case "cash":
      return { kind, customerId, deltaCents: field(formData, "delta") };
    case "drop_transaction":
      return { kind, customerId, entryId: field(formData, "entryId") };
    default:
      return undefined;
  }
}

/**
 * One server action for the whole console; the `action` field says which
 * scenario to fire. Bodies are passed through as the operator typed them — the
 * API validates against `@corgi/contracts` and answers with the real
 * summary, which the console shows verbatim.
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
      case "custodian_file": {
        const tamper = tamperFrom(formData);
        result = await api.custodianFile({ businessDate: field(formData, "businessDate"), ...(tamper ? { tamper } : {}) });
        break;
      }
      case "reconcile":
        result = await api.runReconciliation({ businessDate: field(formData, "businessDate") });
        break;
      case "settle_trades":
        result = await api.settleTrades();
        break;
      default:
        return { ok: false, error: "Unknown live-fire action.", code: "invalid_request", data: null };
    }
    revalidatePath("/ops", "layout");
    revalidatePath("/performance");
    revalidatePath("/portfolio");
    revalidatePath("/overview");
    return { ok: true, error: null, code: null, data: result };
  } catch (error) {
    return fail(error);
  }
}
