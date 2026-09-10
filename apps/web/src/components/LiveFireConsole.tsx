"use client";

import { useActionState } from "react";
import type { LiveFireResponse } from "@corgi/contracts";
import { Button, Field, InlineAlert } from "@corgi/ui";
import { restatementReasonLabel } from "../lib/copy";
import type { ActionResult } from "../server/actions";
import { type LiveFireAction, liveFireAction } from "../server/ops-actions";

interface Scenario {
  readonly action: LiveFireAction;
  readonly title: string;
  readonly detail: string;
  readonly fields: readonly { name: string; label: string; placeholder?: string; type?: "text" | "date"; hint?: string }[];
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
    <article className="live-fire__scenario">
      <header>
        <h2>{scenario.title}</h2>
        <p className="muted small">{scenario.detail}</p>
      </header>
      <form action={action} className="ops-form" noValidate>
        <input type="hidden" name="action" value={scenario.action} />
        <div className="ops-form__grid">
          {scenario.fields.map((f) => (
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
          ))}
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
