"use client";

import { useActionState } from "react";
import type { ApprovalResponse } from "@corgi/contracts";
import { Button, Field, InlineAlert } from "@corgi/ui";
import type { ActionResult } from "../../server/actions";
import { adjustBreakAction, explainBreakAction } from "../../server/operations-actions";

/**
 * The two ways a human closes a break: explain it (custodian is wrong or late)
 * or adjust the ledger to the custodian's figure through a maker-checker
 * approval. Re-running the job never closes a break on its own (ADR-0005).
 */
export function BreakActions({ breakId, adjustable, operatorChosen }: { readonly breakId: string; readonly adjustable: boolean; readonly operatorChosen: boolean }) {
  const [explained, explain, explaining] = useActionState<ActionResult<{ id: string; status: string }> | null, FormData>(explainBreakAction, null);
  const [adjusted, adjust, adjusting] = useActionState<ActionResult<ApprovalResponse> | null, FormData>(adjustBreakAction, null);
  const disabled = !operatorChosen;
  return (
    <div className="break-actions">
      <form action={explain} className="ops-form" noValidate>
        <input type="hidden" name="breakId" value={breakId} />
        <Field id={`explain-${breakId}`} name="note" label="Explain" placeholder="Why the custodian differs; the ledger stands" autoComplete="off" disabled={disabled} />
        <Button type="submit" variant="secondary" pending={explaining} disabled={disabled}>
          Mark explained
        </Button>
        {explained && !explained.ok ? <InlineAlert tone="negative">{explained.error}</InlineAlert> : null}
        {explained?.ok ? <InlineAlert tone="positive">Explained and closed.</InlineAlert> : null}
      </form>
      {adjustable ? (
        <form action={adjust} className="ops-form" noValidate>
          <input type="hidden" name="breakId" value={breakId} />
          <Field id={`adjust-${breakId}`} name="note" label="Adjust ledger" placeholder="Why the custodian's figure is right" autoComplete="off" disabled={disabled} />
          <Button type="submit" variant="secondary" pending={adjusting} disabled={disabled}>
            File adjustment for approval
          </Button>
          {adjusted && !adjusted.ok ? <InlineAlert tone="negative">{adjusted.error}</InlineAlert> : null}
          {adjusted?.ok && adjusted.data ? <InlineAlert tone="positive">Adjustment {adjusted.data.id.slice(0, 8)}… is in the approvals queue for a second operator.</InlineAlert> : null}
        </form>
      ) : null}
      {disabled ? <p className="muted small">Choose who you are acting as (left column) first.</p> : null}
    </div>
  );
}
