"use client";

import { useState, useTransition } from "react";
import type { ModelResponse } from "@corgi/contracts";
import { AllocationBar, Button, InlineAlert, Money } from "@corgi/ui";
import { type ChooseModelResult, chooseModelAction } from "../server/actions";

const RISK = ["", "Conservative", "Cautious", "Balanced", "Growth", "Aggressive"] as const;

/**
 * The model choice is saved before orders are sent (ASSUMPTIONS: record the
 * change, execute in the next window), so a broker failure is a partial
 * outcome and the message must say which half happened. `modelSaved` is read
 * from the refreshed page, not assumed.
 */
function failureCopy(code: string | null, error: string | null, model: { name: string; saved: boolean } | null): string {
  switch (code) {
    case "alpaca_not_configured":
      return "Order placement is not available in this environment yet.";
    case "provider_unavailable":
      return model?.saved
        ? `${model.name} is now your model, but our broker did not accept the orders, so your cash has not been invested yet. Nothing was bought; try again in a moment.`
        : "Our broker did not accept the request, so nothing was bought and your model was not changed. Try again in a moment.";
    default:
      return error ?? "The model could not be chosen.";
  }
}

/**
 * Model catalogue with an explicit confirmation sheet. The server decides
 * whether confirmation is required (any leg at/above the threshold) and returns
 * the exact legs; the sheet shows those numbers, never a client-side estimate.
 */
export function ModelPicker({
  models,
  currentCode,
  availableCents,
  disabled,
}: {
  readonly models: readonly ModelResponse[];
  readonly currentCode: string | null;
  readonly availableCents: string;
  readonly disabled: boolean;
}) {
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string | null>(null);
  const [plan, setPlan] = useState<ChooseModelResult | null>(null);
  const [outcome, setOutcome] = useState<
    { tone: "positive" | "info"; text: string } | { tone: "negative"; code: string | null; error: string | null; modelCode: string } | null
  >(null);

  const available = BigInt(availableCents);

  const choose = (code: string, confirmed: boolean) =>
    start(async () => {
      setOutcome(null);
      setSelected(code);
      const result = await chooseModelAction(code, confirmed);
      if (!result.ok || !result.data) {
        setPlan(null);
        setOutcome({ tone: "negative", code: result.code, error: result.error, modelCode: code });
        return;
      }
      if (!result.data.placed) {
        setPlan(result.data);
        return;
      }
      setPlan(null);
      setOutcome({
        tone: result.data.legs.length > 0 ? "positive" : "info",
        text:
          result.data.legs.length > 0
            ? `${result.data.legs.length} buy order${result.data.legs.length === 1 ? "" : "s"} sent to the broker. Units appear as each order fills.`
            : "Model saved. Nothing was invested because you have no settled cash yet.",
      });
    });

  return (
    <div className="model-picker">
      <ul className="model-grid">
        {models.map((model) => {
          const isCurrent = model.code === currentCode;
          return (
            <li key={model.code} className="model-card" data-current={isCurrent || undefined}>
              <div className="model-card__head">
                <span className="model-card__risk">
                  {RISK[model.riskLevel] ?? "Model"} · risk {model.riskLevel}/5
                </span>
                <h3>{model.name}</h3>
              </div>
              <AllocationBar segments={model.allocations.map((allocation) => ({ symbol: allocation.symbol, weightBps: allocation.targetWeightBps }))} />
              <p className="muted small">Keeps {(model.cashBufferBps / 100).toFixed(0)}% in cash. Rebalanced monthly.</p>
              <Button
                variant={isCurrent ? "secondary" : "primary"}
                disabled={disabled || isCurrent}
                pending={pending && selected === model.code}
                onClick={() => choose(model.code, false)}
              >
                {isCurrent ? "Current model" : available > 0n ? "Choose and invest" : "Choose model"}
              </Button>
            </li>
          );
        })}
      </ul>

      {plan && selected ? (
        <div className="confirm-sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="confirm-sheet__panel">
            <h3 id="confirm-title">Confirm your orders</h3>
            <p className="muted">One or more orders is at or above $1,000. Review the exact amounts before they are sent.</p>
            <ul className="confirm-sheet__legs">
              {plan.legs.map((leg) => (
                <li key={leg.symbol}>
                  <span>Buy {leg.symbol}</span>
                  <Money cents={BigInt(leg.notionalCents)} />
                </li>
              ))}
              <li className="confirm-sheet__total">
                <span>Total</span>
                <Money cents={plan.legs.reduce((sum, leg) => sum + BigInt(leg.notionalCents), 0n)} />
              </li>
            </ul>
            <div className="confirm-sheet__actions">
              <Button variant="secondary" onClick={() => setPlan(null)} disabled={pending}>
                Cancel
              </Button>
              <Button pending={pending} onClick={() => choose(selected, true)}>
                Confirm and send orders
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {outcome ? (
        <InlineAlert tone={outcome.tone}>
          {outcome.tone === "negative"
            ? failureCopy(outcome.code, outcome.error, {
                name: models.find((model) => model.code === outcome.modelCode)?.name ?? "The model",
                // The action revalidated the page, so `currentCode` is what the database says now.
                saved: currentCode === outcome.modelCode,
              })
            : outcome.text}
        </InlineAlert>
      ) : null}
    </div>
  );
}
