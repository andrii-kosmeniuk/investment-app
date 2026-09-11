import type { Metadata } from "next";
import Link from "next/link";
import { ErrorState, StatusPill, Timestamp } from "@corgi/ui";
import { BreakActions } from "../../../components/ops/BreakActions";
import { AGING_ORDER, agingTone, breakFigure, breakStatusTone, reconCategoryLabel, shortId } from "../../../lib/ops-copy";
import { load } from "../../../server/api";
import { OpsPage, OpsSignedOut, opsContext } from "../../../server/ops-page";

export const metadata: Metadata = { title: "Reconciliation · Operations" };

/** Three columns per break — ledger, custodian file, broker — and the age since the file first disagreed. */
export default async function ReconciliationPage() {
  const context = await opsContext();
  if (!context) return <OpsSignedOut current="/ops/reconciliation" title="Reconciliation" />;

  const view = await load(() => context.api.reconciliation());
  if (view.error || !view.data) {
    return (
      <OpsPage context={context} current="/ops/reconciliation">
        <ErrorState title="Couldn't load reconciliation" detail={view.error?.message ?? "Unknown error"} />
      </OpsPage>
    );
  }
  const { latestRun, runs, breaks, openByBucket, today } = view.data;
  const open = breaks.filter((brk) => brk.status === "open");
  const closed = breaks.filter((brk) => brk.status !== "open");
  const operatorChosen = context.operatorId !== null;

  return (
    <OpsPage context={context} current="/ops/reconciliation">
      <header>
        <div>
          <h1>Reconciliation</h1>
          <p>
            Business date {today}.{" "}
            {latestRun
              ? `Last run compared the ${latestRun.fileBusinessDate ?? "—"} custodian file (${latestRun.fileSource ?? "unknown source"}) on ${latestRun.businessDate}.`
              : "No run yet — generate a custodian file and run it from Live fire."}
          </p>
        </div>
        <StatusPill tone={open.length === 0 ? "positive" : "warning"}>
          {open.length} open break{open.length === 1 ? "" : "s"}
        </StatusPill>
      </header>

      <div className="ops-metrics">
        {AGING_ORDER.map((bucket) => (
          <div key={bucket}>
            <span>Open · {bucket}</span>
            <strong>{openByBucket[bucket as keyof typeof openByBucket] ?? 0}</strong>
          </div>
        ))}
        <div>
          <span>Runs</span>
          <strong>{runs.length}</strong>
        </div>
      </div>

      <section className="break-list">
        <div className="section-heading">
          <h2>Open breaks</h2>
          <Link href="/ops/live-fire#reconcile">Run again</Link>
        </div>
        {open.length === 0 ? (
          <p className="muted">Nothing open. A break only closes when a human explains it or an approved adjustment posts.</p>
        ) : (
          open.map((brk) => (
            <article key={brk.id} className="break-card">
              <div className="break-row">
                <div>
                  <StatusPill tone={agingTone(brk.agingBucket)}>
                    {reconCategoryLabel(brk.category)} · {brk.ageDays} day{brk.ageDays === 1 ? "" : "s"} · {brk.agingBucket}
                  </StatusPill>
                  <strong>
                    {brk.key} · customer {shortId(brk.customerId)}
                  </strong>
                  <span>First seen {brk.firstSeenBusinessDate}</span>
                </div>
                <div>
                  <span>Ledger</span>
                  <span className="numeric">{breakFigure(brk.category, brk.ledgerValue)}</span>
                </div>
                <div>
                  <span>Custodian</span>
                  <span className="numeric">{breakFigure(brk.category, brk.custodianValue)}</span>
                </div>
                <div>
                  <span>Broker</span>
                  <span className="numeric">{brk.brokerValue === null ? "—" : breakFigure(brk.category, brk.brokerValue)}</span>
                </div>
              </div>
              <p className="muted small">
                Difference <span className="numeric">{breakFigure(brk.category, brk.delta)}</span> (custodian − ledger).
              </p>
              <BreakActions breakId={brk.id} adjustable={brk.category === "position_units" || brk.category === "cash"} operatorChosen={operatorChosen} />
            </article>
          ))
        )}
      </section>

      {closed.length > 0 ? (
        <section className="break-list">
          <div className="section-heading">
            <h2>Closed</h2>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Break</th>
                <th scope="col">Status</th>
                <th scope="col">Closed by</th>
                <th scope="col">Note</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((brk) => (
                <tr key={brk.id}>
                  <td>
                    {reconCategoryLabel(brk.category)} · {brk.key} · {shortId(brk.customerId)}
                  </td>
                  <td>
                    <StatusPill tone={breakStatusTone(brk.status)}>{brk.status}</StatusPill>
                  </td>
                  <td>
                    {brk.resolvedBy?.displayName ?? "—"}
                    {brk.resolvedAt ? (
                      <span className="muted small">
                        {" "}
                        · <Timestamp value={brk.resolvedAt} />
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {brk.resolutionNote ?? "—"}
                    {brk.resolutionEntryId ? <code className="muted small"> entry {shortId(brk.resolutionEntryId)}</code> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="break-list">
        <div className="section-heading">
          <h2>Runs</h2>
        </div>
        {runs.length === 0 ? (
          <p className="muted">No runs yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Business date</th>
                <th scope="col">File</th>
                <th scope="col">Status</th>
                <th scope="col">Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{run.businessDate}</td>
                  <td>
                    {run.fileBusinessDate ?? "—"} <span className="muted small">{run.fileSource ?? ""}</span>
                  </td>
                  <td>
                    <StatusPill tone={run.status === "completed" ? "positive" : run.status === "failed" ? "negative" : "neutral"}>{run.status}</StatusPill>
                  </td>
                  <td>
                    <Timestamp value={run.startedAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </OpsPage>
  );
}
