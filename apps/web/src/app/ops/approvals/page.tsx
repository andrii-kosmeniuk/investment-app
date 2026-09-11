import type { Metadata } from "next";
import Link from "next/link";
import { type ApprovalResponse, type ApprovalStatus, approvalStatus } from "@corgi/contracts";
import { ErrorState, Money, StatusPill, Timestamp } from "@corgi/ui";
import { ApprovalDecisionForm } from "../../../components/ops/ApprovalDecisionForm";
import { FileRequestForm } from "../../../components/ops/FileRequestForm";
import { actorTag, approvalKindLabel, approvalStatusTone, shortId } from "../../../lib/ops-copy";
import { load } from "../../../server/api";
import { OpsPage, OpsSignedOut, opsContext } from "../../../server/ops-page";

export const metadata: Metadata = { title: "Approvals · Operations" };

const FILTERS: readonly { value: ApprovalStatus | "all"; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

/** The frozen instruction, rendered flat. What was approved is exactly what executes. */
function Payload({ payload }: { readonly payload: ApprovalResponse["payload"] }) {
  const legs = Array.isArray(payload.legs) ? (payload.legs as { symbol: string; side: string; notionalCents: string }[]) : null;
  const rows = Object.entries(payload).filter(([key]) => key !== "legs" && key !== "customerId");
  return (
    <dl className="live-fire__summary">
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd className="numeric">{value === null || value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
        </div>
      ))}
      {legs
        ? legs.map((leg) => (
            <div key={`${leg.side}-${leg.symbol}`}>
              <dt>{leg.side}</dt>
              <dd className="numeric">
                {leg.symbol} · {(Number(leg.notionalCents) / 100).toFixed(2)} USD
              </dd>
            </div>
          ))
        : null}
    </dl>
  );
}

export default async function ApprovalsPage({ searchParams }: { readonly searchParams: Promise<{ status?: string }> }) {
  const context = await opsContext();
  if (!context) return <OpsSignedOut current="/ops/approvals" title="Approvals" />;

  const { status: rawStatus } = await searchParams;
  const parsed = approvalStatus.safeParse(rawStatus);
  const status: ApprovalStatus | null = rawStatus === "all" ? null : parsed.success ? parsed.data : "pending";
  const queue = await load(() => context.api.approvals(status));

  return (
    <OpsPage context={context} current="/ops/approvals">
      <header>
        <div>
          <h1>Approvals</h1>
          <p>Two humans for anything that moves money or trades. The requester can be a person or the agent; the checker is always a different person.</p>
        </div>
        {queue.data ? <StatusPill tone={status === "pending" && queue.data.rows.length > 0 ? "warning" : "neutral"}>{queue.data.rows.length} row{queue.data.rows.length === 1 ? "" : "s"}</StatusPill> : null}
      </header>

      <nav className="ops-filter" aria-label="Filter approvals">
        {FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={filter.value === "pending" ? "/ops/approvals" : `/ops/approvals?status=${filter.value}`}
            className="text-link"
            aria-current={(status ?? "all") === filter.value ? "page" : undefined}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      {queue.error ? (
        <ErrorState title="Couldn't load the queue" detail={queue.error.message} />
      ) : queue.data!.rows.length === 0 ? (
        <p className="muted">Nothing here.</p>
      ) : (
        <div className="approval-cards">
          {queue.data!.rows.map((row) => {
            const tag = actorTag(row.requestedBy.actorType);
            const customerId = typeof row.payload.customerId === "string" ? row.payload.customerId : null;
            return (
              <article key={row.id} id={row.id} className="approval-card">
                <header>
                  <div>
                    <StatusPill tone={approvalStatusTone(row.status)}>{row.status}</StatusPill>
                    <strong>
                      {approvalKindLabel(row.kind)}
                      {customerId ? ` · customer ${shortId(customerId)}` : ""}
                    </strong>
                    <span className="muted small">
                      Requested by {row.requestedBy.displayName} <StatusPill tone={tag.tone}>{tag.label}</StatusPill> · <Timestamp value={row.createdAt} />
                    </span>
                  </div>
                  <Money cents={BigInt(row.amountCents)} />
                </header>
                <Payload payload={row.payload} />
                {row.decision ? (
                  <p className="muted small">
                    {row.decision.decision === "approved" ? "Approved" : "Rejected"} by {row.decision.decidedBy.displayName} · <Timestamp value={row.decision.decidedAt} /> — “{row.decision.reason}”
                  </p>
                ) : (
                  <ApprovalDecisionForm requestId={row.id} selfFiled={row.requestedBy.id === context.operatorId} operatorChosen={context.operatorId !== null} />
                )}
              </article>
            );
          })}
        </div>
      )}

      <section className="live-fire" aria-label="File a request">
        <FileRequestForm kind="withdrawal" operatorChosen={context.operatorId !== null} />
        <FileRequestForm kind="rebalance" operatorChosen={context.operatorId !== null} />
      </section>
    </OpsPage>
  );
}
