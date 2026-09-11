"use client";

import { useActionState } from "react";
import type { ReleaseTradingBlockResponse } from "@corgi/contracts";
import { Button, InlineAlert } from "@corgi/ui";
import type { ActionResult } from "../../server/actions";
import { releaseTradingBlockAction } from "../../server/operations-actions";

/** Closes the bounce receivable and lifts the block — only once settled cash is back above zero (ADR-0005). */
export function ReleaseTradingBlockButton({ customerId }: { readonly customerId: string }) {
  const [state, action, pending] = useActionState<ActionResult<ReleaseTradingBlockResponse> | null, FormData>(releaseTradingBlockAction, null);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="customerId" value={customerId} />
      <Button type="submit" variant="secondary" pending={pending}>
        Release trading block
      </Button>
      {state && !state.ok ? <InlineAlert tone="negative">{state.error}</InlineAlert> : null}
      {state?.ok && state.data ? (
        <InlineAlert tone="positive">
          {state.data.tradingBlocked ? "Still blocked." : `Released. Recovered ${(Number(state.data.recoveredCents) / 100).toFixed(2)} USD from the customer's cash.`}
        </InlineAlert>
      ) : null}
    </form>
  );
}
