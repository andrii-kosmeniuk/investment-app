import { describe, expect, it } from "vitest";
import { ONBOARDING_STEP_HREF, ONBOARDING_STEP_LABEL, dollars, kycLabel, kycTone, percent, restatementReasonLabel, transferStatusTone, valueHeadline } from "./copy";

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

  it("formats returns as signed percentages with a true minus sign", () => {
    expect(percent(0.0341)).toBe("+3.41%");
    expect(percent(-0.002)).toBe("−0.20%");
    expect(percent(0)).toBe("0.00%");
    expect(dollars("1000000")).toBe("$10,000.00");
    expect(dollars("-250")).toBe("−$2.50");
  });

  it("turns machine restatement reasons into sentences and leaves unknown ones alone", () => {
    expect(restatementReasonLabel("corrected_close:VTI@2026-09-09")).toBe("Corrected closing price for VTI on 2026-09-09");
    expect(restatementReasonLabel("late_dividend:VTI@2026-09-02")).toBe("Late dividend on VTI, ex-date 2026-09-02");
    expect(restatementReasonLabel("split:VTI:2-for-1@2026-09-03")).toBe("2-for-1 split of VTI effective 2026-09-03");
    expect(restatementReasonLabel("scheduled")).toBe("Nightly valuation");
    expect(restatementReasonLabel("something_else")).toBe("something_else");
    expect(restatementReasonLabel(null)).toBe("Recomputed");
  });
});
