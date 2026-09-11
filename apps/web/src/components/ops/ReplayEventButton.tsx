"use client";

import { useActionState } from "react";
import type { ReplayEventResponse } from "@corgi/contracts";
import { Button, StatusPill } from "@corgi/ui";
import type { ActionResult } from "../../server/actions";
import { replayEventAction } from "../../server/operations-actions";

/** "Twice is one": re-delivers the stored event through the same inbox; the answer should be `duplicate`. */
export function ReplayEventButton({ eventId }: { readonly eventId: string }) {
  const [state, action, pending] = useActionState<ActionResult<ReplayEventResponse> | null, FormData>(replayEventAction, null);
  return (
    <form action={action} className="stack--row">
      <input type="hidden" name="eventId" value={eventId} />
      <Button type="submit" variant="secondary" pending={pending}>
        Replay
      </Button>
      {state?.ok && state.data ? (
        <StatusPill tone={state.data.receive === "duplicate" ? "positive" : "warning"}>{state.data.receive === "duplicate" ? "Duplicate — ignored" : "Inserted"}</StatusPill>
      ) : null}
      {state && !state.ok ? <StatusPill tone="negative">{state.error}</StatusPill> : null}
    </form>
  );
}
