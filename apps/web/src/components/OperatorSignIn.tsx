"use client";

import { useActionState } from "react";
import { Button, Field } from "@corgi/ui";
import type { ActionResult } from "../server/actions";
import { opsSignInAction } from "../server/ops-actions";

export function OperatorSignIn() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(opsSignInAction, null);
  return (
    <form action={action} className="ops-form" noValidate>
      <Field
        id="token"
        name="token"
        type="password"
        label="Operator token"
        autoComplete="off"
        hint="The API's LIVE_FIRE_TOKEN. Verified against the API and kept only in this browser for eight hours."
        error={state && !state.ok ? state.error : null}
      />
      <Button type="submit" pending={pending}>
        Open console
      </Button>
    </form>
  );
}
