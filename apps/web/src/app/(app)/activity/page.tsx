import type { Metadata } from "next";
import { EmptyState, ErrorState, Money, PageHeading, Timestamp, Units } from "@corgi/ui";
import { cents, units } from "../../../lib/copy";
import { load, requireApi } from "../../../server/api";

export const metadata: Metadata = { title: "Activity" };

function Quantity({ commodity, quantity }: { readonly commodity: string; readonly quantity: string }) {
  return commodity === "USD" ? (
    <Money cents={cents(quantity)} />
  ) : (
    <span className="numeric">
      <Units micro={units(quantity)} /> {commodity}
    </span>
  );
}

export default async function ActivityPage() {
  const api = await requireApi();
  const result = await load(() => api.activity());
  if (result.error) {
    return <ErrorState title="We couldn't load your activity" detail={`${result.error.message} The ledger itself is unaffected.`} />;
  }
  const rows = result.data!.rows;

  return (
    <>
      <PageHeading title="Activity" eyebrow="Every entry on the books">
        <p>Each row is a balanced journal entry. Expand one to see every leg - including the firm-side accounts - exactly as recorded.</p>
      </PageHeading>

      {rows.length === 0 ? (
        <EmptyState title="Nothing on the books yet" detail="Your first deposit will be the first entry. Nothing is ever edited or deleted here; corrections are new entries that reference the original." />
      ) : (
        <ol className="activity">
          {rows.map((row) => (
            <li key={row.entryId} className="activity__row">
              <details>
                <summary>
                  <span className="activity__main">
                    <strong>{row.label}</strong>
                    <span className="muted small">
                      <Timestamp value={row.effectiveAt} />
                      {row.postedAt !== row.effectiveAt ? (
                        <>
                          {" · booked "}
                          <Timestamp value={row.postedAt} />
                        </>
                      ) : null}
                      {" · via "}
                      {row.source}
                    </span>
                  </span>
                  <span className="activity__amount">
                    <Quantity commodity={row.amount.commodity} quantity={row.amount.quantity} />
                  </span>
                </summary>
                <div className="activity__detail">
                  {row.description && row.description !== row.label ? <p className="muted">{row.description}</p> : null}
                  {row.reversesEntryId ? (
                    <p className="muted small">
                      Reverses entry <code>{row.reversesEntryId}</code>
                    </p>
                  ) : null}
                  <div className="table-scroll">
                    <table className="legs">
                      <thead>
                        <tr>
                          <th scope="col">Account</th>
                          <th scope="col" className="numeric-col">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {row.legs.map((leg, index) => (
                          <tr key={`${row.entryId}-${index}`}>
                            <td>
                              <code>{leg.accountPath}</code>
                            </td>
                            <td className="numeric-col">
                              <Quantity commodity={leg.commodity} quantity={leg.quantity} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="muted small">
                    Entry <code>{row.entryId}</code> · kind <code>{row.kind}</code>
                  </p>
                </div>
              </details>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
