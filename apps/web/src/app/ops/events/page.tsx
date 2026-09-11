import type { Metadata } from "next";
import { ErrorState, StatusPill, Timestamp } from "@corgi/ui";
import { ReplayEventButton } from "../../../components/ops/ReplayEventButton";
import { load } from "../../../server/api";
import { OpsPage, OpsSignedOut, opsContext } from "../../../server/ops-page";

export const metadata: Metadata = { title: "Events · Operations" };

const OUTCOME_TONE = { processed: "positive", failed: "negative", pending: "neutral" } as const;

/** Everything that arrived from a provider, whether it was applied, and a replay button that must come back `duplicate`. */
export default async function EventsPage() {
  const context = await opsContext();
  if (!context) return <OpsSignedOut current="/ops/events" title="Inbound events" />;

  const events = await load(() => context.api.events(200));
  return (
    <OpsPage context={context} current="/ops/events">
      <header>
        <div>
          <h1>Inbound events</h1>
          <p>Webhooks and stream events land here first, keyed for idempotency, then a worker applies them. Replay sends the stored event through the same door: twice is one.</p>
        </div>
        {events.data ? <StatusPill tone={events.data.rows.some((row) => row.outcome === "failed") ? "negative" : "positive"}>{events.data.rows.length} shown</StatusPill> : null}
      </header>

      {events.error ? (
        <ErrorState title="Couldn't load events" detail={events.error.message} />
      ) : events.data!.rows.length === 0 ? (
        <p className="muted">No events yet. Fund a deposit or place an order and the providers will start talking.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Received</th>
              <th scope="col">Provider</th>
              <th scope="col">Type</th>
              <th scope="col">Dedupe key</th>
              <th scope="col">Outcome</th>
              <th scope="col">Replay</th>
            </tr>
          </thead>
          <tbody>
            {events.data!.rows.map((row) => {
              const last = row.attempts.at(-1);
              return (
                <tr key={row.id}>
                  <td>
                    <Timestamp value={row.receivedAt} />
                  </td>
                  <td>
                    {row.provider}
                    {row.signatureValid ? null : <StatusPill tone="negative">unsigned</StatusPill>}
                  </td>
                  <td>{row.type}</td>
                  <td>
                    <code className="small">{row.dedupeKey}</code>
                  </td>
                  <td>
                    <span className="stack">
                      <StatusPill tone={OUTCOME_TONE[row.outcome]}>{row.outcome}</StatusPill>
                      {last?.error ? <span className="muted small">{last.error}</span> : null}
                    </span>
                  </td>
                  <td>
                    <ReplayEventButton eventId={row.id} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </OpsPage>
  );
}
