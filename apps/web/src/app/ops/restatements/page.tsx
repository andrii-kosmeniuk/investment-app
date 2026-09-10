import type { Metadata } from "next";
import Link from "next/link";
import { ErrorState, StatusPill, Timestamp } from "@corgi/ui";
import { OperatorSignIn } from "../../../components/OperatorSignIn";
import { OpsShell } from "../../../components/OpsShell";
import { PERIOD_LABEL, dollars, percent, restatementReasonLabel } from "../../../lib/copy";
import { load } from "../../../server/api";
import { opsSignOutAction } from "../../../server/ops-actions";
import { opsApi } from "../../../server/ops-session";

export const metadata: Metadata = { title: "Restatements · Operations" };

const figure = (kind: "valuation" | "return", raw: string): string => (raw === "" ? "—" : kind === "valuation" ? dollars(raw) : percent(Number(raw)));

/** Every superseding version across all customers, newest first: the audit trail behind each "Restated" pill. */
export default async function RestatementsPage({ searchParams }: { readonly searchParams: Promise<{ customerId?: string }> }) {
  const { customerId } = await searchParams;
  const api = await opsApi();

  if (!api) {
    return (
      <OpsShell current="/ops/restatements">
        <header>
          <div>
            <h1>Restatements</h1>
            <p>Operator token required.</p>
          </div>
        </header>
        <OperatorSignIn />
      </OpsShell>
    );
  }

  const audit = await load(() => api.restatements(customerId ?? null));
  return (
    <OpsShell
      current="/ops/restatements"
      account={
        <form action={opsSignOutAction}>
          <button type="submit" className="text-link">
            Close operator session
          </button>
        </form>
      }
    >
      <header>
        <div>
          <h1>Restatements</h1>
          <p>Every published valuation or return that was later superseded. The earlier version is never deleted; it is what the customer sees under &ldquo;as published on&rdquo;.</p>
        </div>
        {audit.data ? <StatusPill tone={audit.data.rows.length === 0 ? "positive" : "warning"}>{audit.data.rows.length} row{audit.data.rows.length === 1 ? "" : "s"}</StatusPill> : null}
      </header>

      <form method="get" action="/ops/restatements" className="ops-filter">
        <label htmlFor="customerId" className="field__label">
          Customer ID
        </label>
        <input id="customerId" name="customerId" defaultValue={customerId ?? ""} placeholder="all customers" className="as-published__input" />
        <button type="submit" className="button" data-variant="secondary">
          <span className="button__label">Filter</span>
        </button>
        {customerId ? (
          <Link href="/ops/restatements" className="text-link">
            Clear
          </Link>
        ) : null}
      </form>

      {audit.error ? (
        <ErrorState title="Couldn't load the audit" detail={audit.error.status === 401 ? "The operator token was rejected; close the session and sign in again." : audit.error.message} />
      ) : audit.data!.rows.length === 0 ? (
        <p className="muted">No restatements. Every figure ever published still stands.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Computed</th>
              <th scope="col">Customer</th>
              <th scope="col">Figure</th>
              <th scope="col" className="numeric-col">Was</th>
              <th scope="col" className="numeric-col">Now</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {audit.data!.rows.map((row) => (
              <tr key={`${row.customerId}-${row.kind}-${row.asOfDate}-${row.period ?? ""}-${row.version}`}>
                <td>
                  <Timestamp value={row.computedAt} />
                </td>
                <td>
                  <Link href={`/ops/restatements?customerId=${row.customerId}`} className="text-link numeric">
                    {row.customerId.slice(0, 8)}…
                  </Link>
                </td>
                <td>
                  {row.kind === "valuation" ? `Value · ${row.asOfDate}` : `${PERIOD_LABEL[row.period ?? "inception"]} · to ${row.asOfDate}`}
                  <span className="muted small"> v{row.version}</span>
                </td>
                <td className="numeric-col numeric">{figure(row.kind, row.from)}</td>
                <td className="numeric-col numeric">{figure(row.kind, row.to)}</td>
                <td>
                  <span className="stack">
                    <span>{restatementReasonLabel(row.reason)}</span>
                    {row.reason ? <code className="muted small">{row.reason}</code> : null}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </OpsShell>
  );
}
