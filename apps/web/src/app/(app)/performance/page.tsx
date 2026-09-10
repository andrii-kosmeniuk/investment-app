import type { Metadata } from "next";
import Link from "next/link";
import { ErrorState, InlineAlert, Money, PageHeading, StatusPill, Timestamp } from "@corgi/ui";
import { PerformanceCard } from "../../../components/PerformanceCard";
import { PERIOD_LABEL, cents, dollars, percent, restatementReasonLabel } from "../../../lib/copy";
import { load, requireApi } from "../../../server/api";

export const metadata: Metadata = { title: "Performance" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Audit rows carry cents for valuations and a fraction for returns; an empty "from" means the first version. */
const figure = (kind: "valuation" | "return", raw: string): string => (raw === "" ? "—" : kind === "valuation" ? dollars(raw) : percent(Number(raw)));

/**
 * Two questions the page answers, as the design brief asks (§7.3):
 *   "What is my return?" — the current figures, with a Restated pill where history moved.
 *   "What did my statement say on <date>?" — exactly the numbers published by that day's
 *   close, nothing computed later. Toggle with the date field; the URL carries the choice.
 */
export default async function PerformancePage({ searchParams }: { readonly searchParams: Promise<{ asPublishedOn?: string }> }) {
  const params = await searchParams;
  const asPublishedOn = params.asPublishedOn && ISO_DATE.test(params.asPublishedOn) ? params.asPublishedOn : null;

  const api = await requireApi();
  const statement = await load(() => api.statement(asPublishedOn));
  if (statement.error) {
    return (
      <ErrorState
        title="We couldn't load your performance"
        detail={`${statement.error.message} Your holdings are unchanged; this is a display failure.`}
        retry={
          <Link href="/performance" className="button" data-variant="secondary">
            <span className="button__label">Try again</span>
          </Link>
        }
      />
    );
  }
  const view = statement.data!;
  const series = [...view.series].reverse();

  return (
    <>
      <PageHeading
        eyebrow={asPublishedOn ? `As published on ${asPublishedOn}` : "Current figures"}
        title="Performance"
        aside={asPublishedOn ? <StatusPill tone="info">Historical view</StatusPill> : null}
      >
        <p>
          Returns are computed from your nightly valuations. When a price is corrected or a dividend arrives late, the affected days are recomputed and
          the earlier figure is kept, so you can always see what you were shown at the time.
        </p>
      </PageHeading>

      <form method="get" action="/performance" className="as-published">
        <label htmlFor="asPublishedOn" className="field__label">
          Show my figures as they were published on
        </label>
        <div className="as-published__controls">
          <input id="asPublishedOn" name="asPublishedOn" type="date" defaultValue={asPublishedOn ?? ""} className="as-published__input" />
          <button type="submit" className="button" data-variant="secondary">
            <span className="button__label">Show</span>
          </button>
          {asPublishedOn ? (
            <Link href="/performance" className="text-link">
              Back to current
            </Link>
          ) : null}
        </div>
        <p className="muted small">
          Knowledge cut-off applied: <Timestamp value={view.publishedAt} />.
        </p>
      </form>

      {asPublishedOn && !view.performance ? (
        <InlineAlert tone="info" title={`Nothing had been published by ${asPublishedOn}`}>
          Your first valuation was recorded after that date.
        </InlineAlert>
      ) : null}

      <PerformanceCard performance={view.performance} showSeriesLink={false} />

      <section className="section">
        <div className="section__heading">
          <h2>Daily values</h2>
          <span className="muted small">{series.length} business days</span>
        </div>
        {series.length === 0 ? (
          <p className="muted">No valuations yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col" className="numeric-col">Value</th>
                <th scope="col" className="numeric-col">Cash</th>
                <th scope="col">Status</th>
                <th scope="col">Computed</th>
              </tr>
            </thead>
            <tbody>
              {series.map((point) => (
                <tr key={point.asOfDate}>
                  <th scope="row">{point.asOfDate}</th>
                  <td className="numeric-col">
                    <Money cents={cents(point.valueCents)} />
                  </td>
                  <td className="numeric-col">
                    <Money cents={cents(point.cashCents)} />
                  </td>
                  <td>
                    <span className="stack">
                      <StatusPill tone={point.status === "final" ? "positive" : "warning"}>{point.status === "final" ? "Final" : "Provisional"}</StatusPill>
                      {point.version > 1 ? <span className="muted small">version {point.version}</span> : null}
                    </span>
                  </td>
                  <td>
                    <span className="stack">
                      <Timestamp value={point.computedAt} />
                      <span className="muted small">{restatementReasonLabel(point.reason)}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <div className="section__heading">
          <h2>Restatements</h2>
          <span className="muted small">Every time a published figure changed</span>
        </div>
        {view.restatements.length === 0 ? (
          <p className="muted">None. Every figure you have been shown still stands.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">What</th>
                <th scope="col" className="numeric-col">Was</th>
                <th scope="col" className="numeric-col">Now</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody>
              {view.restatements.map((row) => (
                <tr key={`${row.kind}-${row.asOfDate}-${row.period ?? ""}-${row.version}`}>
                  <td>
                    <Timestamp value={row.computedAt} />
                  </td>
                  <td>
                    {row.kind === "valuation" ? `Value at ${row.asOfDate} close` : `${PERIOD_LABEL[row.period ?? "inception"]} return to ${row.asOfDate}`}
                    <span className="muted small"> · v{row.version}</span>
                  </td>
                  <td className="numeric-col numeric">{figure(row.kind, row.from)}</td>
                  <td className="numeric-col numeric">{figure(row.kind, row.to)}</td>
                  <td>{restatementReasonLabel(row.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
