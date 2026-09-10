import { describe, expect, it } from "vitest";
import { ONBOARDING_STEP_HREF, ONBOARDING_STEP_LABEL, kycLabel, kycTone, transferStatusTone, valueHeadline } from "./copy";

describe("customer copy", () => {
  it("labels every KYC status without leaking internal names", () => {
    for (const status of ["not_started", "pending", "needs_review", "approved", "declined"] as const) {
      expect(kycLabel(status)).not.toMatch(/_/);
    }
    expect(kycTone("approved")).toBe("positive");
    expect(kycTone("declined")).toBe("negative");
    expect(kycTone("needs_review")).toBe("warning");
  });

  it("gives every onboarding step a label and a destination", () => {
    for (const key of ["account", "identity", "bank", "deposit", "model"] as const) {
      expect(ONBOARDING_STEP_LABEL[key]).toBeTruthy();
      expect(ONBOARDING_STEP_HREF[key]).toMatch(/^\//);
    }
  });

  it("explains a missing or provisional value instead of showing a bare number", () => {
    expect(valueHeadline({ cents: "100", status: "final" }).note).toBeNull();
    expect(valueHeadline({ cents: "100", status: "provisional" }).note).toMatch(/earlier close/);
    expect(valueHeadline({ cents: null, status: "unavailable" }).title).toBe("Value unavailable");
  });

  it("marks returned deposits as negative and in-flight ones as warning", () => {
    expect(transferStatusTone("returned")).toBe("negative");
    expect(transferStatusTone("pending")).toBe("warning");
    expect(transferStatusTone("settled")).toBe("positive");
  });
});
