"use client";

import { useActionState } from "react";
import type { BankAccountResponse } from "@corgi/contracts";
import { Button, Field, InlineAlert } from "@corgi/ui";
import { type ActionResult, createDepositAction } from "../server/actions";

export function DepositForm({ bankAccounts }: { readonly bankAccounts: readonly BankAccountResponse[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createDepositAction, null);

  return (
    <form action={action} className="deposit-form" noValidate>
      <div className="field">
        <label htmlFor="bankAccountId" className="field__label">
          From
        </label>
        <div className="field__control">
          <select id="bankAccountId" name="bankAccountId" defaultValue={bankAccounts[0]?.id} className="field__select">
            {bankAccounts.map((bank) => (
              <option key={bank.id} value={bank.id}>
                {bank.institutionName} ····{bank.accountMask}
              </option>
            ))}
          </select>
        </div>
      </div>
      <Field
        id="amount"
        name="amount"
        label="Amount"
        prefix="$"
        inputMode="decimal"
        placeholder="1,000.00"
        autoComplete="off"
        hint="Sandbox rails: the bank confirms in minutes, settlement is simulated."
        error={state && !state.ok ? state.error : null}
      />
      {state?.ok ? (
        <InlineAlert tone="positive" title="Deposit sent to your bank">
          It appears below as pending once the bank acknowledges it, and settles to cash after that.
        </InlineAlert>
      ) : null}
      <Button type="submit" pending={pending}>
        Add money
      </Button>
    </form>
  );
}
