import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, ErrorState, InlineAlert, Money, PageHeading, Summary, Units } from "@corgi/ui";
import { ONBOARDING_STEP_HREF, ONBOARDING_STEP_LABEL, cents, units, valueHeadline } from "../../../lib/copy";
import { load, requireApi } from "../../../server/api";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const api = await requireApi();
  const [portfolio, onboarding] = await Promise.all([load(() => api.portfolio()), load(() => api.onboarding())]);

  if (portfolio.error || onboarding.error) {
    const error = portfolio.error ?? onboarding.error;
    return (
      <ErrorState
        title="We couldn't load your overview"
        detail={`${error?.message ?? "The API did not answer."} Nothing has changed on your account.`}
        retry={
          <Link href="/overview" className="button" data-variant="secondary">
            <span className="button__label">Try again</span>
          </Link>
        }
      />
    );
  }
  const view = portfolio.data!;
  const rail = onboarding.data!;
  const kyc = rail.customer.kycStatus;
  const nextStep = rail.steps.find((step) => step.status === "current" || step.status === "blocked");
  const headline = valueHeadline(view.value);
  const pendingDeposits = cents(view.cash.pendingDepositCents);
  const hasAnything = view.positions.length > 0 || cents(view.cash.settledCents) > 0n || pendingDeposits > 0n;

  return (
    <>
      <PageHeading eyebrow={`As of ${view.asOf}`} title={<>Good to see you, {rail.customer.displayName.split(" ")[0]}.</>} />

      {kyc !== "approved" ? (
        <InlineAlert
          tone={kyc === "declined" ? "negative" : "warning"}
          title={kyc === "declined" ? "We couldn't verify your identity" : "Identity verification is not complete"}
          action={
            kyc === "declined" ? null : (
              <Link href="/onboarding" className="button" data-variant="secondary">
                <span className="button__label">Continue</span>
              </Link>
            )
          }
        >
          {kyc === "declined"
            ? "Money cannot be added or invested. Contact support to review the decision."
            : "Money cannot be added or invested until your identity check is approved."}
        </InlineAlert>
      ) : null}

      {pendingDeposits > 0n ? (
        <InlineAlert tone="info" title="Deposit on its way">
          <Money cents={pendingDeposits} /> is pending at your bank. It becomes investable when it settles, usually within a few business days.{" "}
          <Link href="/transfers">Track it</Link>
        </InlineAlert>
      ) : null}

      <section className="headline-value" aria-labelledby="value-heading">
        <p className="label" id="value-heading">
          {headline.title}
        </p>
        {view.value.cents !== null ? (
          <h2 className="headline-value__figure">
            <Money cents={cents(view.value.cents)} />
          </h2>
        ) : (
          <h2 className="headline-value__figure headline-value__figure--muted">—</h2>
        )}
        {headline.note ? <p className="headline-value__note">{headline.note}</p> : null}
        <p className="headline-value__return">
          {view.return ? (
            <>
              {view.return.period} return {`${(view.return.twr * 100).toFixed(2)}%`}
            </>
          ) : (
            "Performance appears after your first valuation."
          )}
        </p>
      </section>

      <Summary
        items={[
          { label: "Available to invest", value: <Money cents={cents(view.cash.availableToInvestCents)} /> },
          { label: "Pending deposits", value: <Money cents={pendingDeposits} /> },
          { label: "Unsettled buys", value: <Money cents={-cents(view.cash.unsettledBuysCents)} /> },
          { label: "Model", value: view.model ? view.model.name : "Not chosen" },
        ]}
      />

      {!hasAnything ? (
        <EmptyState
          title={kyc === "approved" ? "Your account is ready to fund." : "Nothing on the books yet."}
          detail={
            kyc === "approved"
              ? "Link a bank account and add money. Every dollar shows up here the moment your bank confirms it."
              : "Once your identity is verified you can link a bank and add money."
          }
          action={
            nextStep ? (
              <Link href={ONBOARDING_STEP_HREF[nextStep.key]} className="button" data-variant="primary">
                <span className="button__label">{ONBOARDING_STEP_LABEL[nextStep.key]}</span>
              </Link>
            ) : null
          }
        />
      ) : (
        <section className="section">
          <div className="section__heading">
            <h2>Holdings</h2>
            <Link href="/portfolio" className="text-link">
              Full portfolio →
            </Link>
          </div>
          {view.positions.length === 0 ? (
            <p className="muted">
              No holdings yet.{" "}
              {view.model ? "Orders appear here as they fill." : <Link href="/portfolio">Choose a model</Link>}
              {!view.model ? " to invest your settled cash." : ""}
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Symbol</th>
                  <th scope="col" className="numeric-col">Units</th>
                  <th scope="col" className="numeric-col">Value</th>
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
                      {position.valueCents !== null ? <Money cents={cents(position.valueCents)} /> : <span className="muted">Price unavailable</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {nextStep && hasAnything ? (
        <section className="section">
          <div className="section__heading">
            <h2>Next step</h2>
          </div>
          <p className="muted">
            {nextStep.detail ?? ONBOARDING_STEP_LABEL[nextStep.key]}{" "}
            <Link href={ONBOARDING_STEP_HREF[nextStep.key]}>{ONBOARDING_STEP_LABEL[nextStep.key]} →</Link>
          </p>
        </section>
      ) : null}
    </>
  );
}
