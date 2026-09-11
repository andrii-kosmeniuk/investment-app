"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiClientError } from "./api-client";
import { anonymousApi, requireApi } from "./api";
import { clearSessionCookie, writeSessionCookie } from "./session";

export interface ActionResult<T = null> {
  readonly ok: boolean;
  readonly error: string | null;
  readonly code: string | null;
  readonly data: T | null;
}

const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, error: null, code: null, data });
const fail = <T,>(error: unknown): ActionResult<T> => {
  if (error instanceof ApiClientError) return { ok: false, error: error.message, code: error.code, data: null };
  return { ok: false, error: "Something went wrong on our side. Nothing was changed.", code: "unknown", data: null };
};

export async function signInAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { ok: false, error: "Enter your email and password.", code: "invalid_request", data: null };
  try {
    const session = await anonymousApi().signIn(email, password);
    await writeSessionCookie(session.token, new Date(session.expiresAt));
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 401) {
      return { ok: false, error: "Email or password is incorrect.", code: error.code, data: null };
    }
    return fail(error);
  }
  redirect("/overview");
}

export async function signOutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/sign-in");
}

export async function startVerificationAction(): Promise<ActionResult<{ url: string }>> {
  try {
    const api = await requireApi();
    const session = await api.startVerification();
    const url = new URL("https://inquiry.withpersona.com/verify");
    url.searchParams.set("inquiry-id", session.inquiryId);
    url.searchParams.set("session-token", session.sessionToken);
    if (process.env.WEB_ORIGIN) url.searchParams.set("redirect-uri", `${process.env.WEB_ORIGIN}/onboarding`);
    revalidatePath("/onboarding");
    return ok({ url: url.toString() });
  } catch (error) {
    return fail(error);
  }
}

export async function createLinkTokenAction(): Promise<ActionResult<{ linkToken: string }>> {
  try {
    const api = await requireApi();
    return ok(await api.createLinkToken());
  } catch (error) {
    return fail(error);
  }
}

export async function linkBankAction(input: {
  publicToken: string;
  accountId: string;
  institutionName: string;
  accountMask: string;
}): Promise<ActionResult<{ id: string }>> {
  try {
    const api = await requireApi();
    const linked = await api.linkBank(input);
    revalidatePath("/transfers");
    revalidatePath("/onboarding");
    return ok({ id: linked.id });
  } catch (error) {
    return fail(error);
  }
}

export async function createDepositAction(_previous: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const bankAccountId = String(formData.get("bankAccountId") ?? "");
  const amount = String(formData.get("amount") ?? "").trim();
  if (!bankAccountId) return { ok: false, error: "Choose the bank account to debit.", code: "invalid_request", data: null };
  if (!amount) return { ok: false, error: "Enter an amount.", code: "invalid_request", data: null };
  try {
    const api = await requireApi();
    await api.createDeposit(bankAccountId, amount);
    revalidatePath("/transfers");
    revalidatePath("/overview");
    revalidatePath("/onboarding");
    return ok(null);
  } catch (error) {
    return fail(error);
  }
}

export interface ChooseModelResult {
  readonly legs: readonly { symbol: string; notionalCents: string }[];
  readonly placed: boolean;
}

export async function chooseModelAction(modelCode: string, confirmed: boolean): Promise<ActionResult<ChooseModelResult>> {
  try {
    const api = await requireApi();
    const result = await api.chooseModel(modelCode, confirmed);
    revalidatePath("/portfolio");
    revalidatePath("/overview");
    revalidatePath("/onboarding");
    return ok({ legs: result.legs, placed: true });
  } catch (error) {
    if (error instanceof ApiClientError && error.confirmation) {
      return ok({ legs: error.confirmation.legs, placed: false });
    }
    // The model assignment is saved before the legs are routed, so a broker
    // failure can leave a chosen model with no orders: re-read so the page
    // shows what actually persisted instead of the pre-click state.
    revalidatePath("/portfolio");
    revalidatePath("/overview");
    return fail(error);
  }
}
