import type { KycStatus, OnboardingStepKey, PortfolioResponse, TransferResponse } from "@corgi/contracts";
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

/** Contract integers arrive as strings; parse once at the edge of the screen. */
export const cents = (value: string): bigint => BigInt(value);
export const units = (value: string): bigint => BigInt(value);
