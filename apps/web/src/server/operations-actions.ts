"use server";

import { revalidatePath } from "next/cache";
import type { ApprovalResponse, DecideApprovalResponse, FiledApprovalResponse, ReleaseTradingBlockResponse, ReplayEventResponse } from "@corgi/contracts";
import type { ActionResult } from "./actions";
import { formField as field, opsFailure as fail } from "./ops-errors";
import { opsApi } from "./ops-session";

const expired = <T,>(): ActionResult<T> => ({ ok: false, error: "Operator session expired. Sign in again.", code: "unauthorized", data: null });
const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, error: null, code: null, data });

/** Every operations write runs the same way: call the API, refresh the console, report honestly. */
async function run<T>(operation: (api: NonNullable<Awaited<ReturnType<typeof opsApi>>>) => Promise<T>): Promise<ActionResult<T>> {
  const api = await opsApi();
  if (!api) return expired();
  try {
    const data = await operation(api);
    revalidatePath("/ops", "layout");
    revalidatePath("/portfolio");
    revalidatePath("/overview");
    revalidatePath("/activity");
    return ok(data);
  } catch (error) {
    return fail(error);
  }
}

export async function decideApprovalAction(_previous: ActionResult<DecideApprovalResponse> | null, formData: FormData): Promise<ActionResult<DecideApprovalResponse>> {
  const decision = field(formData, "decision");
  if (decision !== "approved" && decision !== "rejected") return { ok: false, error: "Choose approve or reject.", code: "invalid_request", data: null };
  return run((api) => api.decideApproval(field(formData, "requestId"), { decision, reason: field(formData, "reason") }));
}

/** Files a request into the queue by hand — the same use-case the agent's MCP tools call. */
export async function fileRequestAction(_previous: ActionResult<FiledApprovalResponse> | null, formData: FormData): Promise<ActionResult<FiledApprovalResponse>> {
  const kind = field(formData, "kind");
  const customerId = field(formData, "customerId");
  const reason = field(formData, "reason");
  if (kind === "rebalance") return run((api) => api.proposeRebalance({ customerId, reason }));
  if (kind === "withdrawal") return run((api) => api.requestWithdrawal({ customerId, reason, amountCents: field(formData, "amountCents") }));
  return { ok: false, error: "Unknown request kind.", code: "invalid_request", data: null };
}

export async function explainBreakAction(_previous: ActionResult<{ id: string; status: string }> | null, formData: FormData) {
  return run((api) => api.explainBreak(field(formData, "breakId"), { note: field(formData, "note") }));
}

export async function adjustBreakAction(_previous: ActionResult<ApprovalResponse> | null, formData: FormData): Promise<ActionResult<ApprovalResponse>> {
  return run((api) => api.adjustBreak(field(formData, "breakId"), { note: field(formData, "note") }));
}

export async function replayEventAction(_previous: ActionResult<ReplayEventResponse> | null, formData: FormData): Promise<ActionResult<ReplayEventResponse>> {
  return run((api) => api.replayEvent(field(formData, "eventId")));
}

export async function releaseTradingBlockAction(
  _previous: ActionResult<ReleaseTradingBlockResponse> | null,
  formData: FormData,
): Promise<ActionResult<ReleaseTradingBlockResponse>> {
  return run((api) => api.releaseTradingBlock(field(formData, "customerId")));
}
