"use client";

import { useActionState } from "react";
import type { LiveFireResponse } from "@corgi/contracts";
import { Button, Field, InlineAlert } from "@corgi/ui";
import { restatementReasonLabel } from "../lib/copy";
import type { ActionResult } from "../server/actions";
import { type LiveFireAction, liveFireAction } from "../server/ops-actions";

interface ScenarioField {
  readonly name: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly type?: "text" | "date";
  readonly hint?: string;
  /** Renders a select instead of an input. */
  readonly options?: readonly { value: string; label: string }[];
}

interface Scenario {
  readonly action: LiveFireAction;
  readonly title: string;
  readonly detail: string;
  readonly fields: readonly ScenarioField[];
}

const SCENARIOS: readonly Scenario[] = [
  {
    action: "corrected_close",
    title: "Corrected closing price",
    detail: "Records a new version of a close. Every customer holding the symbol is revalued from that date and their returns are restated; the old figure stays visible as published.",
    fields: [
      { name: "symbol", label: "Symbol", placeholder: "VTI" },
      { name: "tradeDate", label: "Trade date", type: "date" },
      { name: "close", label: "Corrected close", placeholder: "297.05", hint: "Up to 8 decimals." },
    ],
  },
  {
    action: "late_dividend",
    title: "Late dividend",
    detail: "Books the entitlement at the ex-date close and the cash on the pay date, then restates from the ex-date. Dividends count as return, not as a flow.",
    fields: [
      { name: "customerId", label: "Customer ID", placeholder: "uuid" },
      { name: "symbol", label: "Symbol", placeholder: "VTI" },
      { name: "exDate", label: "Ex-date", type: "date" },
      { name: "payDate", label: "Pay date", type: "date" },
      { name: "amountCents", label: "Amount (cents)", placeholder: "4000" },
    ],
  },
  {
    action: "stock_split",
    title: "Stock split",
    detail: "Multiplies units, rescales every open lot's basis per unit and records split-adjusted closes. The customer's value and time-weighted return must not move — the response says whether they did.",
    fields: [
      { name: "customerId", label: "Customer ID", placeholder: "uuid" },
      { name: "symbol", label: "Symbol", placeholder: "VTI" },
      { name: "numerator", label: "New units", placeholder: "2" },
      { name: "denominator", label: "For every", placeholder: "1" },
      { name: "effectiveDate", label: "Effective date", type: "date" },
    ],
  },
  {
    action: "run_valuation",
    title: "Run valuations",
    detail: "The nightly job, on demand, for a window of business days. Idempotent: an unchanged day writes nothing.",
    fields: [
      { name: "from", label: "From", type: "date" },
      { name: "to", label: "To", type: "date" },
      { name: "customerId", label: "Customer ID (optional)", placeholder: "leave blank for everyone" },
    ],
  },
  {
    action: "collect_closes",
    title: "Collect closes",
    detail: "Pulls daily bars from the market-data provider for the window. A bar that differs from a stored close is a correction and triggers a restatement.",
    fields: [
      { name: "from", label: "From", type: "date" },
      { name: "to", label: "To", type: "date" },
    ],
  },
  {
    action: "custodian_file",
    title: "Custodian file",
    detail:
      "There is no real custodian, so the simulator projects our own ledger as of the close and stores the CSV. Pick a tamper to plant a discrepancy the reconciliation must catch — the file is labelled as tampered.",
    fields: [
      { name: "businessDate", label: "Business date", type: "date" },
      {
        name: "tamperKind",
        label: "Tamper",
        options: [
          { value: "", label: "None — clean file" },
          { value: "position", label: "Position units (delta in micro-units)" },
          { value: "cash", label: "Cash (delta in cents)" },
          { value: "drop_transaction", label: "Drop a transaction (entry id)" },
        ],
      },
      { name: "customerId", label: "Customer ID", placeholder: "uuid (for a tamper)" },
      { name: "symbol", label: "Symbol", placeholder: "VTI (position tamper)" },
      { name: "delta", label: "Delta", placeholder: "-500000", hint: "Signed integer: micro-units for a position, cents for cash." },
      { name: "entryId", label: "Entry ID", placeholder: "uuid (drop a transaction)" },
    ],
  },
  {
    action: "reconcile",
    title: "Run reconciliation",
    detail: "The 06:10 ET job, on demand: ledger vs the latest custodian file on or before the date, broker positions as a third column. Re-running refreshes open breaks and never closes one.",
    fields: [{ name: "businessDate", label: "Business date", type: "date" }],
  },
  {
    action: "settle_trades",
    title: "Settle due trades",
    detail: "The 00:05 ET job: every fill whose T+1 contractual date has arrived moves its cash from unsettled to settled. Idempotent per fill.",
    fields: [],
  },
];

function Outcome({ result }: { readonly result: LiveFireResponse }) {
  const entries = Object.entries(result.summary);
  return (
    <InlineAlert tone="positive" title="Done — this is what actually happened">
      <dl className="live-fire__summary">
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd className="numeric">{value === null ? "—" : String(value)}</dd>
          </div>
        ))}
      </dl>
      {result.restatements.length === 0 ? (
        <p className="muted small">No published figure changed.</p>
      ) : (
        <ul className="live-fire__restatements">
          {result.restatements.map((r) => (
            <li key={`${r.customerId}-${r.fromDate}-${r.reason}`}>
              <strong>{r.customerId.slice(0, 8)}…</strong> from {r.fromDate}: {r.valuationsRewritten} valuation{r.valuationsRewritten === 1 ? "" : "s"},{" "}
              {r.returnsRewritten} return{r.returnsRewritten === 1 ? "" : "s"} rewritten across {r.dates.length} day{r.dates.length === 1 ? "" : "s"} —{" "}
              {restatementReasonLabel(r.reason)}
            </li>
          ))}
        </ul>
      )}
    </InlineAlert>
  );
}

function ScenarioForm({ scenario }: { readonly scenario: Scenario }) {
  const [state, action, pending] = useActionState<ActionResult<LiveFireResponse> | null, FormData>(liveFireAction, null);
  return (
    <article className="live-fire__scenario" id={scenario.action}>
      <header>
        <h2>{scenario.title}</h2>
        <p className="muted small">{scenario.detail}</p>
      </header>
      <form action={action} className="ops-form" noValidate>
        <input type="hidden" name="action" value={scenario.action} />
        <div className="ops-form__grid">
          {scenario.fields.map((f) =>
            f.options ? (
              <div key={f.name} className="field">
                <label htmlFor={`${scenario.action}-${f.name}`} className="field__label">
                  {f.label}
                </label>
                <div className="field__control">
                  <select id={`${scenario.action}-${f.name}`} name={f.name} defaultValue="">
                    {f.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <Field
                key={f.name}
                id={`${scenario.action}-${f.name}`}
                name={f.name}
                label={f.label}
                type={f.type ?? "text"}
                autoComplete="off"
                {...(f.placeholder ? { placeholder: f.placeholder } : {})}
                {...(f.hint ? { hint: f.hint } : {})}
              />
            ),
          )}
        </div>
        {state && !state.ok ? (
          <InlineAlert tone="negative" title="Nothing was changed">
            {state.error}
          </InlineAlert>
        ) : null}
        {state?.ok && state.data ? <Outcome result={state.data} /> : null}
        <Button type="submit" variant="secondary" pending={pending}>
          Fire
        </Button>
      </form>
    </article>
  );
}

export function LiveFireConsole() {
  return (
    <div className="live-fire">
      {SCENARIOS.map((scenario) => (
        <ScenarioForm key={scenario.action} scenario={scenario} />
      ))}
    </div>
  );
}
