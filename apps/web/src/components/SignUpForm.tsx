"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, Field } from "@corgi/ui";
import { MIN_PASSWORD_LENGTH, type SignUpField } from "../lib/sign-up";
import { type SignUpResult, signUpAction } from "../server/actions";

export function SignUpForm() {
  const [state, action, pending] = useActionState<SignUpResult | null, FormData>(signUpAction, null);
  const errorFor = (field: SignUpField): string | null => (state?.problem.field === field ? state.problem.message : null);

  return (
    <form action={action} className="signin-form" noValidate>
      <Field
        id="displayName"
        name="displayName"
        type="text"
        label="Your name"
        autoComplete="name"
        required
        defaultValue={state?.fields.displayName ?? ""}
        error={errorFor("displayName")}
      />
      <Field
        id="email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        inputMode="email"
        required
        defaultValue={state?.fields.email ?? ""}
        error={errorFor("email")}
      />
      <Field
        id="password"
        name="password"
        type="password"
        label="Password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        error={errorFor("password")}
      />
      <Button type="submit" pending={pending}>
        Create account
      </Button>
      <p className="signin-form__switch">
        Already have an account? <Link href="/sign-in">Sign in</Link>
      </p>
    </form>
  );
}
