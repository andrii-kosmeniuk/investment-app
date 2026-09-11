import type { Metadata } from "next";
import Link from "next/link";
import { ErrorState, Money, StatusPill, Timestamp } from "@corgi/ui";
import { ReleaseTradingBlockButton } from "../../components/ops/ReleaseTradingBlockButton";
import { actorTag, agingTone, approvalKindLabel, reconCategoryLabel, breakFigure, shortId } from "../../lib/ops-copy";
import { load } from "../../server/api";
import { OpsPage, OpsSignedOut, opsContext } from "../../server/ops-page";

export const metadata: Metadata = { title: "Operations" };

/** The morning glance: what needs a second human, what doesn't reconcile, what came in overnight. */
export default async function OperationsPage() {
  const context = await opsContext();
  if (!context) return <OpsSignedOut current="/ops" title="Operational truth" />;

  const [overview, approvals, recon] = await Promise.all([
    load(() => context.api.overview()),
    load(() => context.api.approvals("pending")),
    load(() => context.api.reconciliation()),
  ]);
  const error = overview.error ?? approvals.error ?? recon.error;
  if (error || !overview.data || !approvals.data || !recon.data) {
    return (
      <OpsPage context={context} current="/ops">
        <ErrorState title="Couldn't load the overview" detail={error?.message ?? "Unknown error"} />
      </OpsPage>
    );
  }

  const o = overview.data;
  const openBreaks = recon.data.breaks.filter((brk) => brk.status === "open").slice(0, 5);
  const pending = approvals.data.rows.slice(0, 5);
  const unhealthy = o.providers.filter((p) => !p.configured);

  return (
    <OpsPage context={context} current="/ops">
      <header>
        <div>
          <h1>Operational truth</h1>
          <p>
            <Timestamp value={o.now} /> · {o.latestRun ? `last reconciliation ${o.latestRun.businessDate} (${o.latestRun.status})` : "no reconciliation run yet"}
          </p>
        </div>
        <StatusPill tone={unhealthy.length === 0 ? "positive" : "warning"}>
          {unhealthy.length === 0 ? `${o.providers.length} providers configured` : `${unhealthy.map((p) => p.name).join(", ")} not configured`}
        </StatusPill>
      </header>

      <div className="ops-metrics">
        <div>
          <span>Pending approvals</span>
          <strong>{o.pendingApprovals}</strong>
        </div>
        <div>
          <span>Open breaks</span>
          <strong>
            {o.openBreaks}
            {o.oldestOpenBreakDays !== null ? <small className="muted"> · oldest {o.oldestOpenBreakDays}d</small> : null}
          </strong>
        </div>
        <div>
          <span>Events today</span>
          <strong>
            {o.eventsToday}
            {o.failedEvents > 0 ? <small className="negative"> · {o.failedEvents} failed</small> : null}
          </strong>
        </div>
        <div>
          <span>Awaiting settlement</span>
          <strong>{o.pendingSettlements}</strong>
        </div>
      </div>

      {o.blockedCustomers.length > 0 ? (
        <section className="approval-list">
          <div className="section-heading">
            <h2>Trading paused</h2>
            <span>Deposit returned after investing; a sell-to-cover request is in the queue.</span>
          </div>
          {o.blockedCustomers.map((customer) => (
            <article key={customer.customerId} className="approval-row">
              <div>
                <strong>{customer.displayName}</strong>
                <span className="numeric">{customer.customerId}</span>
              </div>
              <span />
              <ReleaseTradingBlockButton customerId={customer.customerId} />
            </article>
          ))}
        </section>
      ) : null}

      <section className="break-list">
        <div className="section-heading">
          <h2>Reconciliation breaks</h2>
          <Link href="/ops/reconciliation">Open reconciliation</Link>
        </div>
        {openBreaks.length === 0 ? (
          <p className="muted">No open breaks. Ledger, custodian file and broker agree.</p>
        ) : (
          openBreaks.map((brk) => (
            <article key={brk.id} className="break-row">
              <div>
                <StatusPill tone={agingTone(brk.agingBucket)}>
                  {reconCategoryLabel(brk.category)} · {brk.ageDays} day{brk.ageDays === 1 ? "" : "s"}
                </StatusPill>
                <strong>
                  {brk.key} · {shortId(brk.customerId)}
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
                <span>Difference</span>
                <span className="numeric">{breakFigure(brk.category, brk.delta)}</span>
              </div>
            </article>
          ))
        )}
      </section>

      <section className="approval-list">
        <div className="section-heading">
          <h2>Awaiting a second operator</h2>
          <Link href="/ops/approvals">Open the queue</Link>
        </div>
        {pending.length === 0 ? (
          <p className="muted">Nothing waiting.</p>
        ) : (
          pending.map((row) => {
            const tag = actorTag(row.requestedBy.actorType);
            return (
              <article key={row.id} className="approval-row">
                <div>
                  <strong>
                    {approvalKindLabel(row.kind)} · {shortId(String(row.payload.customerId ?? ""))}
                  </strong>
                  <span>
                    Requested by {row.requestedBy.displayName} <StatusPill tone={tag.tone}>{tag.label}</StatusPill> · <Timestamp value={row.createdAt} />
                  </span>
                </div>
                <Money cents={BigInt(row.amountCents)} />
                <Link href={`/ops/approvals#${row.id}`} className="button" data-variant="secondary">
                  <span className="button__label">Review</span>
                </Link>
              </article>
            );
          })
        )}
      </section>
    </OpsPage>
  );
}
