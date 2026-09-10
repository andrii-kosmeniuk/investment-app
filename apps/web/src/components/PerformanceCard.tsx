import Link from "next/link";
import type { PerformanceResponse, PeriodReturnResponse } from "@corgi/contracts";
import { Money, Percentage, StatusPill, Timestamp } from "@corgi/ui";
import { PERIOD_LABEL, cents, dollars, percent, restatementReasonLabel } from "../lib/copy";

/**
 * "Restated on <date> · was <figure>" — shown only when the customer could have
 * seen a different number earlier (ADR-0004). The pill is deliberately louder
 * than the figure it sits next to: a changed history is the thing to notice.
 */
export function RestatedPill({ restated, previous }: { readonly restated: { at: string; reason: string | null } | null; readonly previous: string }) {
  if (!restated) return null;
  return (
    <span className="restated" title={restatementReasonLabel(restated.reason)}>
      <StatusPill tone="warning">Restated</StatusPill>
      <span className="restated__detail">
        on <Timestamp value={restated.at} /> · was {previous}
      </span>
    </span>
  );
}

function ReturnRow({ row }: { readonly row: PeriodReturnResponse }) {
  return (
    <tr>
      <th scope="row">
        <span className="stack">
          <span>{PERIOD_LABEL[row.period]}</span>
          <span className="muted small">
            {row.periodStart} → {row.periodEnd}
          </span>
        </span>
      </th>
      <td className="numeric-col">
        <span className="stack stack--end">
          <Percentage value={row.twr} />
          <RestatedPill restated={row.restated} previous={row.restated ? percent(row.restated.previous) : ""} />
        </span>
      </td>
      <td className="numeric-col">{row.mwr === null ? <span className="muted">—</span> : <Percentage value={row.mwr} />}</td>
      <td className="numeric-col">
        <Money cents={cents(row.flowsCents)} />
      </td>
    </tr>
  );
}

/**
 * The performance block shared by the overview, portfolio and statement pages.
 * Headline is the since-inception time-weighted return; money-weighted sits
 * beside it with a one-line explanation of why the two differ.
 */
export function PerformanceCard({
  performance,
  showSeriesLink = true,
}: {
  readonly performance: PerformanceResponse | null;
  readonly showSeriesLink?: boolean;
}) {
  if (!performance) {
    return (
      <section className="section performance" aria-labelledby="performance-heading">
        <div className="section__heading">
          <h2 id="performance-heading">Performance</h2>
        </div>
        <p className="muted">Performance appears after your first nightly valuation, once you hold something or have settled cash.</p>
      </section>
    );
  }

  const inception = performance.returns.find((r) => r.period === "inception") ?? null;
  const valueRestated = performance.restated;

  return (
    <section className="section performance" aria-labelledby="performance-heading">
      <div className="section__heading">
        <h2 id="performance-heading">Performance</h2>
        <span className="muted small">
          Valued at the {performance.asOfDate} close
          {performance.status === "provisional" ? " · provisional" : ""}
          {showSeriesLink ? (
            <>
              {" · "}
              <Link href="/performance" className="text-link">
                History and statements →
              </Link>
            </>
          ) : null}
        </span>
      </div>

      <div className="performance__headline">
        <div>
          <p className="label">Time-weighted return, since you started</p>
          <p className="performance__figure">{inception ? <Percentage value={inception.twr} /> : <span className="muted">—</span>}</p>
          {inception?.restated ? <RestatedPill restated={inception.restated} previous={percent(inception.restated.previous)} /> : null}
        </div>
        <div>
          <p className="label">Money-weighted return</p>
          <p className="performance__figure performance__figure--secondary">
            {inception?.mwr !== null && inception?.mwr !== undefined ? <Percentage value={inception.mwr} /> : <span className="muted">—</span>}
          </p>
        </div>
        <div>
          <p className="label">Value at close</p>
          <p className="performance__figure performance__figure--secondary">
            <Money cents={cents(performance.valueCents)} />
          </p>
          {valueRestated ? <RestatedPill restated={valueRestated} previous={dollars(valueRestated.previous)} /> : null}
        </div>
      </div>
      <p className="muted small performance__explainer">
        Time-weighted is the model&rsquo;s performance; money-weighted is yours, including the timing of your deposits. Deposits, withdrawals and fees are
        treated as cash flows; dividends count as return.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col" className="numeric-col">Time-weighted</th>
            <th scope="col" className="numeric-col">Money-weighted</th>
            <th scope="col" className="numeric-col">Net flows</th>
          </tr>
        </thead>
        <tbody>
          {performance.returns.map((row) => (
            <ReturnRow key={row.period} row={row} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
