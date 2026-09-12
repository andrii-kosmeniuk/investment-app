import type { Metadata } from "next";
import Link from "next/link";
import { AllocationBar, CashBreakdown, EmptyState, ErrorState, InlineAlert, Money, PageHeading, StatusPill, Units } from "@corgi/ui";
import { ModelPicker } from "../../../components/ModelPicker";
import { PerformanceCard } from "../../../components/PerformanceCard";
import { cents, priceStatusLabel, units, valueHeadline } from "../../../lib/copy";
import { load, requireApi } from "../../../server/api";

export const metadata: Metadata = { title: "Portfolio" };

const bps = (value: number): string => `${(value / 100).toFixed(1)}%`;

/** Customer-facing wording for an order that has not closed yet. */
function orderStateLabel(state: string): string {
  switch (state) {
    case "approved":
      return "Queued — broker unavailable";
    case "pending_approval":
      return "Awaiting approval";
    case "submitted":
    case "accepted":
      return "Sent to broker";
    case "queued_for_open":
      return "Waiting for market open";
    case "partially_filled":
      return "Partly filled";
    default:
      return state.replace(/_/g, " ");
  }
}

export default async function PortfolioPage() {
  const api = await requireApi();
  const [portfolio, models, me] = await Promise.all([load(() => api.portfolio()), load(() => api.models()), load(() => api.me())]);
  if (portfolio.error || models.error || me.error) {
    const error = portfolio.error ?? models.error ?? me.error;
    return <ErrorState title="We couldn't load your portfolio" detail={`${error?.message ?? "The API did not answer."} Your holdings are unchanged; this is a display failure.`} />;
  }
  const view = portfolio.data!;
  const catalogue = models.data!.models;
  const customer = me.data!.customer;
  const headline = valueHeadline(view.value);
  const available = cents(view.cash.availableToInvestCents);
  const currentModel = view.model ? catalogue.find((model) => model.code === view.model?.code) ?? null : null;
  const canInvest = customer.kycStatus === "approved" && !customer.tradingBlocked;
  const queuedOrders = view.openOrders.filter((order) => order.state === "approved").length;

  return (
    <>
      <PageHeading
        eyebrow={`As of ${view.asOf}`}
        title={
          view.value.cents !== null ? (
            <span className="headline-value__figure">
              <Money cents={cents(view.value.cents)} />
            </span>
          ) : (
            "Value unavailable"
          )
        }
        aside={view.value.status !== "final" ? <StatusPill tone="warning">{view.value.status === "provisional" ? "Provisional" : "Price missing"}</StatusPill> : null}
      >
        <p>{headline.note ?? headline.title}</p>
      </PageHeading>

      <section className="section two-column">
        <div>
          <div className="section__heading">
            <h2>Cash</h2>
          </div>
          <CashBreakdown
            settledCents={cents(view.cash.settledCents)}
            pendingDepositCents={cents(view.cash.pendingDepositCents)}
            unsettledBuysCents={cents(view.cash.unsettledBuysCents)}
            unsettledSellsCents={cents(view.cash.unsettledSellsCents)}
            availableToInvestCents={available}
            availableToWithdrawCents={cents(view.cash.availableToWithdrawCents)}
          />
        </div>
        <div>
          <div className="section__heading">
            <h2>Model</h2>
            {currentModel ? <StatusPill tone="info">{currentModel.name}</StatusPill> : null}
          </div>
          {currentModel ? (
            <AllocationBar segments={currentModel.allocations.map((allocation) => ({ symbol: allocation.symbol, weightBps: allocation.targetWeightBps }))} />
          ) : (
            <p className="muted">No model chosen yet. Pick one below to invest your settled cash.</p>
          )}
        </div>
      </section>

      <PerformanceCard performance={view.performance} />

      <section className="section">
        <div className="section__heading">
          <h2>Holdings</h2>
          {view.openOrders.length > 0 ? <StatusPill tone="warning">{view.openOrders.length} open order{view.openOrders.length === 1 ? "" : "s"}</StatusPill> : null}
        </div>
        {view.positions.length === 0 ? (
          <EmptyState
            title={view.openOrders.length > 0 ? (queuedOrders === view.openOrders.length ? "Orders are queued" : "Orders are working") : "No holdings yet"}
            detail={
              view.openOrders.length > 0
                ? queuedOrders > 0
                  ? `${queuedOrders === view.openOrders.length ? "Your buys are" : `${queuedOrders} of your buys are`} held because our broker is not answering right now. We re-send them automatically every half minute; your cash stays yours until each order fills.`
                  : "Your buys have been sent to the broker. Units appear here as each order fills, and every fill is booked to your activity."
                : available > 0n
                  ? "You have settled cash. Choose a model to invest it."
                  : "Add money first; once it settles you can choose a model."
            }
            action={available <= 0n ? <Link href="/transfers" className="button" data-variant="secondary"><span className="button__label">Add money</span></Link> : null}
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col" className="numeric-col">Units</th>
                <th scope="col" className="numeric-col">Price</th>
                <th scope="col" className="numeric-col">Value</th>
                <th scope="col" className="numeric-col">Weight / target</th>
              </tr>
            </thead>
            <tbody>
              {view.positions.map((position) => (
                <tr key={position.symbol}>
                  <th scope="row">{position.symbol}</th>
                  <td className="numeric-col">
                    <Units micro={units(position.unitsMicro)} />
                  </td>
                  <td className="numeric-col">
                    {position.price ? (
                      <span className="stack">
                        <span className="numeric">${position.price.value}</span>
                        <span className="muted small">
                          {priceStatusLabel(position.price.status)} {position.price.asOfDate}
                        </span>
                      </span>
                    ) : (
                      <span className="muted">Price unavailable</span>
                    )}
                  </td>
                  <td className="numeric-col">{position.valueCents !== null ? <Money cents={cents(position.valueCents)} /> : <span className="muted">—</span>}</td>
                  <td className="numeric-col">
                    {position.actualWeightBps !== null ? bps(position.actualWeightBps) : "—"}
                    {position.targetWeightBps !== null ? <span className="muted"> / {bps(position.targetWeightBps)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view.openOrders.length > 0 ? (
          <ul className="open-orders">
            {view.openOrders.map((order) => (
              <li key={order.id}>
                <span>
                  {order.side === "buy" ? "Buy" : "Sell"} {order.symbol}
                </span>
                <Money cents={cents(order.notionalCents)} />
                <StatusPill tone="warning">{orderStateLabel(order.state)}</StatusPill>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="section" id="models">
        <div className="section__heading">
          <h2>{currentModel ? "Change model" : "Choose a model"}</h2>
        </div>
        {customer.kycStatus === "approved" && customer.tradingBlocked ? (
          <InlineAlert tone="warning" title="Trading is paused">
            A deposit was returned by your bank after it had been invested. We are settling the difference and will reopen trading as soon as that is done; your holdings are unchanged in the meantime.
          </InlineAlert>
        ) : !canInvest ? (
          <InlineAlert tone="warning" title="Investing is not open yet">
            Choose a model once your identity check is approved. <Link href="/onboarding">See onboarding</Link>.
          </InlineAlert>
        ) : null}
        <ModelPicker models={catalogue} currentCode={currentModel?.code ?? null} availableCents={view.cash.availableToInvestCents} disabled={!canInvest} />
      </section>
    </>
  );
}
