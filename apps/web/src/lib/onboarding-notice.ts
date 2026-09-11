import type { OnboardingResponse } from "@corgi/contracts";
import { ONBOARDING_STEP_HREF, ONBOARDING_STEP_LABEL, kycLabel } from "./copy";

export interface OnboardingNotice {
  readonly tone: "accent" | "negative";
  /**
   * Short state word for the pill: what is true now, not what the customer must
   * do. Identity states reuse `kycLabel` so the band and the account chip agree.
   */
  readonly status: string;
  /** "Step 2 of 5" — the position in the rail, never a claim about time. */
  readonly progress: string;
  readonly title: string;
  readonly detail: string;
  readonly action: { readonly label: string; readonly href: string } | null;
}

/**
 * Derives the shell-wide onboarding notice from the server's rail (ADR-0006).
 * Returns null once every step is complete; the notice says what is blocked
 * (funding, investing) and names the single next step, in the product's words.
 */
export function onboardingNotice(view: Pick<OnboardingResponse, "steps" | "identity">): OnboardingNotice | null {
  const steps = view.steps;
  const total = steps.length;
  const index = steps.findIndex((step) => step.status === "current" || step.status === "blocked");
  if (index === -1) return null;
  const step = steps[index]!;
  const progress = `Step ${index + 1} of ${total}`;
  const href = ONBOARDING_STEP_HREF[step.key];

  if (step.key === "identity") {
    switch (view.identity.status) {
      case "pending":
        return {
          tone: "accent",
          status: kycLabel("pending"),
          progress,
          title: "Your identity check is with Persona",
          detail: "Nothing to do for now. Adding money and investing unlock once it is approved.",
          action: { label: "See status", href },
        };
      case "needs_review":
        return {
          tone: "accent",
          status: kycLabel("needs_review"),
          progress,
          title: "Your identity check needs more information",
          detail: "Finish the check to unlock funding and investing.",
          action: { label: "Continue verification", href },
        };
      case "declined":
        return {
          tone: "negative",
          status: kycLabel("declined"),
          progress,
          title: "We couldn't verify your identity",
          detail: "Money cannot be added or invested. Contact support to review the decision.",
          action: { label: "Details", href },
        };
      default:
        return {
          tone: "accent",
          status: "Action needed",
          progress,
          title: "Verify your identity to start investing",
          detail: "You can look around now. Adding money and choosing a model unlock once your identity is approved.",
          action: { label: "Verify identity", href },
        };
    }
  }

  const label = ONBOARDING_STEP_LABEL[step.key];
  const detail =
    step.key === "bank"
      ? "Connect the bank account you will fund from. Linking is not a deposit."
      : step.key === "deposit"
        ? "Deposits arrive by ACH and settle before they can be invested."
        : "Pick one of four model portfolios; your settled cash is invested to its target weights.";
  return {
    tone: "accent",
    status: "Action needed",
    progress,
    title: `Next: ${label.toLowerCase()}`,
    detail,
    action: { label, href },
  };
}
