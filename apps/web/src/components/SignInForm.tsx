"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, InlineAlert } from "@corgi/ui";
import { PRODUCT_NAME } from "../lib/product";
import { type ActionResult, signInAction } from "../server/actions";

export function SignInForm({ expired }: { readonly expired: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(signInAction, null);

  return (
    <form action={action} className="signin-form" noValidate>
      {expired && !state ? (
        <InlineAlert tone="info">Your session ended. Sign in again to continue.</InlineAlert>
      ) : null}
      <Field
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="username"
        inputMode="email"
        required
        defaultValue=""
      />
      <Field
        id="password"
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
        error={state && !state.ok ? state.error : null}
      />
      <Button type="submit" pending={pending}>
        Sign in
      </Button>
      <p className="signin-form__switch">
        New to {PRODUCT_NAME}? <Link href="/sign-up">Create an account</Link>
      </p>
    </form>
  );
}
