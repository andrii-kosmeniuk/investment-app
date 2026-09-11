"use client";

import { useActionState } from "react";
import type { FiledApprovalResponse } from "@corgi/contracts";
import { Button, Field, InlineAlert } from "@corgi/ui";
import type { ActionResult } from "../../server/actions";
import { fileRequestAction } from "../../server/operations-actions";

/** Files a withdrawal or rebalance request by hand; the agent's MCP tools call the same use-cases. */
export function FileRequestForm({ kind, operatorChosen }: { readonly kind: "withdrawal" | "rebalance"; readonly operatorChosen: boolean }) {
  const [state, action, pending] = useActionState<ActionResult<FiledApprovalResponse> | null, FormData>(fileRequestAction, null);
  return (
    <article className="live-fire__scenario">
      <header>
        <h2>{kind === "withdrawal" ? "Request a withdrawal" : "Propose a rebalance"}</h2>
        <p className="muted small">
          {kind === "withdrawal"
            ? "Files the amount for a second operator. Approval posts the ledger withdrawal; the bank payout rail is out of scope (CUT_LIST)."
            : "Values the customer at the latest closes and files the drift legs. Nothing is traded until a second operator approves."}
        </p>
      </header>
      <form action={action} className="ops-form" noValidate>
        <input type="hidden" name="kind" value={kind} />
        <div className="ops-form__grid">
          <Field id={`${kind}-customerId`} name="customerId" label="Customer ID" placeholder="uuid" autoComplete="off" />
          {kind === "withdrawal" ? <Field id={`${kind}-amountCents`} name="amountCents" label="Amount (cents)" placeholder="15000" autoComplete="off" /> : null}
          <Field id={`${kind}-reason`} name="reason" label="Reason" placeholder="Why this is being filed" autoComplete="off" />
        </div>
        {!operatorChosen ? <p className="muted small">Choose who you are acting as (left column) first.</p> : null}
        {state && !state.ok ? (
          <InlineAlert tone="negative" title="Not filed">
            {state.error}
          </InlineAlert>
        ) : null}
        {state?.ok && state.data ? (
          <InlineAlert tone="positive" title={state.data.status === "filed" ? "Filed for a second operator" : "Already in balance"}>
            {state.data.status === "filed" ? (
              <ul className="live-fire__restatements">
                {state.data.legs.length === 0 ? <li>Request {state.data.approvalId?.slice(0, 8)}… is in the queue.</li> : null}
                {state.data.legs.map((leg) => (
                  <li key={`${leg.side}-${leg.symbol}`}>
                    {leg.side} {leg.symbol} for {(Number(leg.notionalCents) / 100).toFixed(2)} USD
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Every allocation is within its drift band; nothing to file.</p>
            )}
          </InlineAlert>
        ) : null}
        <Button type="submit" variant="secondary" pending={pending} disabled={!operatorChosen}>
          File request
        </Button>
      </form>
    </article>
  );
}
