"use client";

import { useActionState } from "react";
import type { DecideApprovalResponse } from "@corgi/contracts";
import { Button, Field, InlineAlert } from "@corgi/ui";
import type { ActionResult } from "../../server/actions";
import { decideApprovalAction } from "../../server/operations-actions";

/**
 * The checker's form. When the acting operator filed the request the buttons
 * are disabled up front; the API refuses it anyway (409) and so does the
 * database trigger — belt, braces and a second belt (ADR-0005).
 */
export function ApprovalDecisionForm({ requestId, selfFiled, operatorChosen }: { readonly requestId: string; readonly selfFiled: boolean; readonly operatorChosen: boolean }) {
  const [state, action, pending] = useActionState<ActionResult<DecideApprovalResponse> | null, FormData>(decideApprovalAction, null);
  const disabled = selfFiled || !operatorChosen;
  return (
    <form action={action} className="ops-form" noValidate>
      <input type="hidden" name="requestId" value={requestId} />
      <Field id={`reason-${requestId}`} name="reason" label="Reason" placeholder="What you checked, in a sentence" autoComplete="off" disabled={disabled} />
      {selfFiled ? (
        <p className="muted small">You filed this request. A different operator has to decide it.</p>
      ) : !operatorChosen ? (
        <p className="muted small">Choose who you are acting as (left column) before deciding.</p>
      ) : null}
      <div className="stack--row">
        <Button type="submit" name="decision" value="approved" pending={pending} disabled={disabled}>
          Approve
        </Button>
        <Button type="submit" name="decision" value="rejected" variant="secondary" pending={pending} disabled={disabled}>
          Reject
        </Button>
      </div>
      {state && !state.ok ? (
        <InlineAlert tone="negative" title="Not decided">
          {state.error}
        </InlineAlert>
      ) : null}
      {state?.ok && state.data ? (
        <InlineAlert tone="positive" title={state.data.request.status === "approved" ? "Approved and executed" : "Rejected"}>
          {state.data.outcome ? (
            <dl className="live-fire__summary">
              {Object.entries(state.data.outcome).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd className="numeric">{value === null ? "—" : String(value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="muted small">Nothing was executed.</p>
          )}
        </InlineAlert>
      ) : null}
    </form>
  );
}
