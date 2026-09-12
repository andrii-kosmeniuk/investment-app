import type { PlateFigure } from "../components/landing/Plate";

/**
 * Landing-page content (ADR-0006). Everything here is a product fact the API
 * enforces — onboarding order, gating, providers — or a figure's file name.
 * Claims about outcomes are deliberately absent (design brief §13).
 */

/** Section anchors shared by the header, the mobile menu and the footer. */
export const LANDING_SECTIONS = [
  { id: "how-it-works", label: "How it works" },
  { id: "models", label: "Four models" },
  { id: "restatements", label: "Nothing rewritten" },
  { id: "sandbox", label: "Sandbox" },
] as const;

/** Frames live in `apps/web/public/plates/`; provenance is embedded in each PNG's tEXt chunk. */
export const FIELD_GUIDE: Readonly<Record<"clouds" | "garden", PlateFigure>> = {
  clouds: { stem: "clouds", subject: "Cloud bank", width: 1200, height: 1600 },
  garden: { stem: "garden", subject: "Raked garden", width: 1200, height: 1600 },
};

export const ONBOARDING_STEPS: readonly { readonly title: string; readonly detail: string }[] = [
  { title: "Create an account", detail: "Your name, an email and a password. This alone moves no money." },
  {
    title: "Verify your identity",
    detail: "Persona runs the check. Until it is approved you can look, but not fund or invest.",
  },
  { title: "Link a bank", detail: "Plaid connects the account you will fund from. Linking is not a deposit." },
  {
    title: "Add money",
    detail: "Deposits arrive by ACH and settle before they can be invested; pending, posted and settled are shown apart.",
  },
  {
    title: "Choose a model",
    detail: "Pick one of four model portfolios. Settled cash is invested to its target weights, less the cash buffer.",
  },
];

/** Same vocabulary as the model picker inside the product. */
export const MODEL_RISK_WORD: readonly string[] = ["", "Conservative", "Cautious", "Balanced", "Growth", "Aggressive"];

export const PROVIDERS: readonly { readonly name: string; readonly role: string }[] = [
  { name: "Persona (sandbox)", role: "Identity verification" },
  { name: "Plaid (sandbox)", role: "Bank linking and ACH deposits" },
  { name: "Alpaca Broker (sandbox)", role: "Brokerage accounts and paper orders" },
  { name: "Alpaca market data", role: "Daily closing prices" },
  { name: "Custodian file", role: "Simulated — reconciled every morning, labelled as simulated" },
];
