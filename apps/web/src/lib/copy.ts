import type { KycStatus, OnboardingStepKey, PortfolioResponse, ReturnPeriod, TransferResponse } from "@corgi/contracts";
import type { StatusTone } from "@corgi/ui";

/** Customer-facing wording lives here so screens never invent a label. */

export function kycLabel(status: KycStatus): string {
  switch (status) {
    case "not_started":
      return "Identity not verified";
    case "pending":
      return "Identity check in progress";
    case "needs_review":
      return "Identity needs review";
    case "approved":
      return "Identity verified";
    case "declined":
      return "Identity check declined";
  }
}

export function kycTone(status: KycStatus): StatusTone {
  switch (status) {
    case "approved":
      return "positive";
    case "declined":
      return "negative";
    case "not_started":
      return "neutral";
    default:
      return "warning";
  }
}

export const ONBOARDING_STEP_LABEL: Readonly<Record<OnboardingStepKey, string>> = {
  account: "Create account",
  identity: "Verify identity",
  bank: "Link a bank",
  deposit: "Add money",
  model: "Choose a model",
};

export const ONBOARDING_STEP_HREF: Readonly<Record<OnboardingStepKey, string>> = {
  account: "/overview",
  identity: "/onboarding",
  bank: "/transfers",
  deposit: "/transfers",
  model: "/portfolio",
};

export function transferStatusLabel(status: TransferResponse["status"]): string {
  switch (status) {
    case "initiated":
      return "Sent to bank";
    case "pending":
      return "Pending";
    case "settled":
      return "Settled";
    case "returned":
      return "Returned";
  }
}

export function transferStatusTone(status: TransferResponse["status"]): StatusTone {
  switch (status) {
    case "settled":
      return "positive";
    case "returned":
      return "negative";
    default:
      return "warning";
  }
}

export function depositStepLabel(step: "pending" | "settled"): string {
  return step === "pending" ? "Pending at bank" : "Settled to cash";
}

/** Headline copy for the portfolio value, honest about why a number is missing. */
export function valueHeadline(value: PortfolioResponse["value"]): { title: string; note: string | null } {
  switch (value.status) {
    case "final":
      return { title: "Portfolio value", note: null };
    case "provisional":
      return { title: "Portfolio value", note: "Provisional: one or more prices are from an earlier close." };
    case "unavailable":
      return { title: "Value unavailable", note: "A held position has no usable price yet. Cash is exact; holdings are shown in units." };
  }
}

export function priceStatusLabel(status: "final" | "stale"): string {
  return status === "final" ? "Close" : "Stale close";
}

export const PERIOD_LABEL: Readonly<Record<ReturnPeriod, string>> = {
  mtd: "This month",
  ytd: "This year",
  inception: "Since you started",
};

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Decimal-string cents → "$1,234.56" (for inline text where the <Money> element does not fit). */
export function dollars(centsValue: string): string {
  const value = BigInt(centsValue);
  const formatted = usd.format(Number(value < 0n ? -value : value) / 100);
  return value < 0n ? `−${formatted}` : formatted;
}

/** Fraction → signed percentage string, two decimals: 0.0341 → "+3.41%". */
export function percent(fraction: number): string {
  const sign = fraction > 0 ? "+" : fraction < 0 ? "−" : "";
  return `${sign}${Math.abs(fraction * 100).toFixed(2)}%`;
}

/**
 * Machine reasons from the ledger (`corrected_close:VTI@2026-09-09`) in plain words.
 * Unknown shapes are shown verbatim rather than guessed at.
 */
export function restatementReasonLabel(reason: string | null): string {
  if (!reason) return "Recomputed";
  const colon = reason.indexOf(":");
  const kind = colon === -1 ? reason : reason.slice(0, colon);
  const rest = colon === -1 ? "" : reason.slice(colon + 1);
  const at = rest.indexOf("@");
  const subject = at === -1 ? rest : rest.slice(0, at);
  const date = at === -1 ? null : rest.slice(at + 1);
  switch (kind) {
    case "corrected_close":
      return date ? `Corrected closing price for ${subject} on ${date}` : `Corrected closing price for ${subject}`;
    case "late_dividend":
      return date ? `Late dividend on ${subject}, ex-date ${date}` : `Late dividend on ${subject}`;
    case "split": {
      const [symbol, ratio] = subject.split(":") as [string, string?];
      return date ? `${ratio ?? "Stock"} split of ${symbol} effective ${date}` : `${ratio ?? "Stock"} split of ${symbol}`;
    }
    case "scheduled":
      return "Nightly valuation";
    default:
      return reason;
  }
}

/** Contract integers arrive as strings; parse once at the edge of the screen. */
export const cents = (value: string): bigint => BigInt(value);
export const units = (value: string): bigint => BigInt(value);
