import { describe, expect, it } from "vitest";
import type { OnboardingResponse } from "@corgi/contracts";
import { kycLabel } from "./copy";
import { onboardingNotice } from "./onboarding-notice";

type Step = OnboardingResponse["steps"][number];
type Status = Step["status"];

function rail(statuses: readonly Status[], identity: OnboardingResponse["identity"]["status"]) {
  const keys = ["account", "identity", "bank", "deposit", "model"] as const;
  const steps: Step[] = keys.map((key, index) => ({ key, status: statuses[index] ?? "upcoming", detail: null }));
  return { steps, identity: { status: identity, inquiryId: null, canStart: identity !== "approved" && identity !== "declined" } };
}

describe("onboardingNotice", () => {
  it("is silent once every step is complete", () => {
    expect(onboardingNotice(rail(["complete", "complete", "complete", "complete", "complete"], "approved"))).toBeNull();
  });

  it("asks a new customer to verify their identity and says what is blocked", () => {
    const notice = onboardingNotice(rail(["complete", "current"], "not_started"));
    expect(notice).toMatchObject({ tone: "accent", progress: "Step 2 of 5", action: { href: "/onboarding" } });
    expect(notice?.title).toMatch(/verify your identity/i);
    expect(notice?.detail).toMatch(/adding money/i);
  });

  it("reports a pending check as waiting, not as something the customer must do", () => {
    const notice = onboardingNotice(rail(["complete", "current"], "pending"));
    expect(notice).toMatchObject({ status: kycLabel("pending"), action: { label: "See status" } });
    expect(notice?.status).not.toMatch(/action needed/i);
    expect(notice?.detail).not.toMatch(/\d+\s*(minutes|hours|days)/i);
  });

  it("uses the shared identity vocabulary so the band and the account chip agree", () => {
    expect(onboardingNotice(rail(["complete", "current"], "not_started"))?.status).toBe("Action needed");
    expect(onboardingNotice(rail(["complete", "current"], "needs_review"))?.status).toBe(kycLabel("needs_review"));
    expect(onboardingNotice(rail(["complete", "blocked"], "declined"))?.status).toBe(kycLabel("declined"));
  });

  it("marks a declined check as negative with a details action", () => {
    const notice = onboardingNotice(rail(["complete", "blocked"], "declined"));
    expect(notice).toMatchObject({ tone: "negative", action: { label: "Details", href: "/onboarding" } });
  });

  it("points an approved customer at the next unfinished step", () => {
    expect(onboardingNotice(rail(["complete", "complete", "current"], "approved"))).toMatchObject({
      progress: "Step 3 of 5",
      title: "Next: link a bank",
      action: { href: "/transfers" },
    });
    expect(onboardingNotice(rail(["complete", "complete", "complete", "complete", "current"], "approved"))).toMatchObject({
      progress: "Step 5 of 5",
      action: { href: "/portfolio" },
    });
  });
});
