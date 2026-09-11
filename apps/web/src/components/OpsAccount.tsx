import type { OperatorResponse } from "@corgi/contracts";
import { chooseOperatorAction, opsSignOutAction } from "../server/ops-actions";

/**
 * Left-column identity block. The token opened the console; this names which
 * human is acting so every approval, explanation and adjustment is attributed
 * and self-approval can be refused (ADR-0005).
 */
export function OpsAccount({ operators, operatorId }: { readonly operators: readonly OperatorResponse[]; readonly operatorId: string | null }) {
  const current = operators.find((operator) => operator.id === operatorId) ?? null;
  return (
    <div className="ops-account">
      <form action={chooseOperatorAction} className="ops-account__picker">
        <label htmlFor="operatorId" className="field__label">
          Acting as
        </label>
        <select id="operatorId" name="operatorId" defaultValue={current?.id ?? ""} className="ops-account__select">
          <option value="" disabled>
            Choose operator…
          </option>
          {operators.map((operator) => (
            <option key={operator.id} value={operator.id}>
              {operator.displayName} · {operator.role}
            </option>
          ))}
        </select>
        <button type="submit" className="button" data-variant="secondary">
          <span className="button__label">Set</span>
        </button>
      </form>
      {current ? null : <p className="muted small">Approvals and break decisions need a named operator.</p>}
      <form action={opsSignOutAction}>
        <button type="submit" className="text-link">
          Close operator session
        </button>
      </form>
    </div>
  );
}
