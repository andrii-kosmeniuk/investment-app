import type { PlateFigure } from "../components/landing/Plate";

/**
 * Landing-page content (ADR-0006). Everything here is a product fact the API
 * enforces — onboarding order, gating, providers — or a figure's file name.
 * Claims about outcomes are deliberately absent (design brief §13).
 */

/** Section anchors shared by the header, the mobile menu and the footer. */
export const LANDING_SECTIONS = [
  { id: "how-it-works", label: "Steps" },
  { id: "models", label: "Models" },
  { id: "restatements", label: "Corrections" },
  { id: "sandbox", label: "Sandbox" },
] as const;

/** Frames live in `apps/web/public/plates/`; provenance is embedded in each PNG's tEXt chunk. */
export const FIELD_GUIDE: Readonly<Record<"clouds" | "garden", PlateFigure>> = {
  clouds: { stem: "clouds", subject: "Cloud bank", width: 1200, height: 1600 },
  garden: { stem: "garden", subject: "Raked garden", width: 1200, height: 1600 },
};

export const ONBOARDING_STEPS: readonly { readonly title: string; readonly detail: string }[] = [
  { title: "Open your account", detail: "Name, email, and a password - nothing moves on this step." },
  {
    title: "Confirm your identity",
    detail: "Persona runs the check. Browse freely until you're approved; then you can fund and invest.",
  },
  { title: "Link your bank", detail: "Plaid connects the account you'll fund from. Linking is not a deposit." },
  {
    title: "Deposit funds",
    detail: "ACH deposits settle before they invest. Pending, posted, and settled - shown separately.",
  },
  {
    title: "Select a portfolio",
    detail: "One of four fixed models. Settled cash invested to target weights, minus the cash buffer.",
  },
];

/** Same vocabulary as the model picker inside the product. */
export const MODEL_RISK_WORD: readonly string[] = ["", "Conservative", "Cautious", "Balanced", "Growth", "Aggressive"];

export const PROVIDERS: readonly { readonly name: string; readonly role: string }[] = [
  { name: "Persona (sandbox)", role: "Identity verification" },
  { name: "Plaid (sandbox)", role: "Bank linking and ACH deposits" },
  { name: "Alpaca Broker (sandbox)", role: "Brokerage accounts and paper orders" },
  { name: "Alpaca market data", role: "Daily closing prices" },
  { name: "Custodian file", role: "Simulated - reconciled every morning, labelled as simulated" },
];
