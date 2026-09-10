import type { CustomerProfile, IdentityInquiryRecord, KycStatus } from "../ports.js";

export type OnboardingStepKey = "account" | "identity" | "bank" | "deposit" | "model";
export type OnboardingStepStatus = "complete" | "current" | "upcoming" | "blocked";

export interface OnboardingStep {
  readonly key: OnboardingStepKey;
  readonly status: OnboardingStepStatus;
  readonly detail: string | null;
}

export interface OnboardingView {
  readonly steps: readonly OnboardingStep[];
  readonly identity: {
    readonly status: KycStatus;
    readonly inquiryId: string | null;
    readonly canStart: boolean;
  };
}

export interface OnboardingViewInput {
  readonly profile: CustomerProfile;
  readonly latestInquiry: IdentityInquiryRecord | null;
  readonly hasBankAccount: boolean;
  readonly hasDeposit: boolean;
  readonly hasModel: boolean;
}

const IDENTITY_DETAIL: Readonly<Record<KycStatus, string | null>> = {
  not_started: "Verify your identity before adding money.",
  pending: "Your identity check is still in progress. You can return here to check its status.",
  needs_review: "Your identity check needs more information.",
  approved: null,
  declined: "We couldn't verify your identity with the information provided.",
};

/**
 * Derives the five-step rail from server facts only. A step is "complete" when
 * the provider or ledger confirms it — never because the customer was redirected
 * back. The rail shows the next step; it never pretends a later one is done.
 */
export function buildOnboardingView(input: OnboardingViewInput): OnboardingView {
  const kyc = input.profile.kycStatus;
  const identityStatus: OnboardingStepStatus =
    kyc === "approved" ? "complete" : kyc === "declined" ? "blocked" : "current";

  const sequence: OnboardingStep[] = [
    { key: "account", status: "complete", detail: null },
    { key: "identity", status: identityStatus, detail: IDENTITY_DETAIL[kyc] },
  ];

  let previousComplete = identityStatus === "complete";
  const remaining: readonly [OnboardingStepKey, boolean, string][] = [
    ["bank", input.hasBankAccount, "Connect the bank account you will fund from."],
    ["deposit", input.hasDeposit, "Deposits arrive by ACH and settle before they can be invested."],
    ["model", input.hasModel, "Pick one of four model portfolios once your cash has settled."],
  ];
  for (const [key, done, detail] of remaining) {
    const status: OnboardingStepStatus = done ? "complete" : previousComplete ? "current" : "upcoming";
    sequence.push({ key, status, detail: status === "complete" ? null : detail });
    previousComplete = done;
  }

  return {
    steps: sequence,
    identity: {
      status: kyc,
      inquiryId: input.latestInquiry?.inquiryId ?? null,
      canStart: kyc === "not_started" || kyc === "pending" || kyc === "needs_review",
    },
  };
}
