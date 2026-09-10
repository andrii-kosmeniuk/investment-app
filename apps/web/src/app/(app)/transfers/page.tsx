import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, ErrorState, InlineAlert, Money, PageHeading, StatusPill, Timeline, Timestamp } from "@corgi/ui";
import { DepositForm } from "../../../components/DepositForm";
import { PlaidLinkButton } from "../../../components/PlaidLinkButton";
import { cents, depositStepLabel, transferStatusLabel, transferStatusTone } from "../../../lib/copy";
import { load, requireApi } from "../../../server/api";

export const metadata: Metadata = { title: "Transfers" };

export default async function TransfersPage() {
  const api = await requireApi();
  const [transfers, me] = await Promise.all([load(() => api.transfers()), load(() => api.me())]);
  if (transfers.error || me.error) {
    const error = transfers.error ?? me.error;
    return <ErrorState title="We couldn't load your transfers" detail={`${error?.message ?? "The API did not answer."} Nothing has changed on your account.`} />;
  }
  const view = transfers.data!;
  const kyc = me.data!.customer.kycStatus;
  const canFund = kyc === "approved";
  const activeBanks = view.bankAccounts.filter((bank) => bank.status === "active");

  return (
    <>
      <PageHeading title="Transfers" eyebrow="Money in">
        <p>Deposits move by ACH from a linked bank. Cash appears here when your bank confirms it, and becomes investable when it settles.</p>
      </PageHeading>

      {!canFund ? (
        <InlineAlert tone="warning" title="Identity verification required" action={<Link href="/onboarding" className="button" data-variant="secondary"><span className="button__label">Verify identity</span></Link>}>
          Bank linking and deposits open once your identity check is approved.
        </InlineAlert>
      ) : null}

      <section className="section two-column">
        <div>
          <div className="section__heading">
            <h2>Linked banks</h2>
            {canFund ? <PlaidLinkButton /> : null}
          </div>
          {view.bankAccounts.length === 0 ? (
            <p className="muted">No bank linked yet.{canFund ? " Link one to add money." : ""}</p>
          ) : (
            <ul className="bank-list">
              {view.bankAccounts.map((bank) => (
                <li key={bank.id}>
                  <span>
                    <strong>{bank.institutionName}</strong> ····{bank.accountMask}
                  </span>
                  <StatusPill tone={bank.status === "active" ? "positive" : "negative"}>{bank.status === "active" ? "Connected" : "Disconnected"}</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="section__heading">
            <h2>Add money</h2>
          </div>
          {canFund && activeBanks.length > 0 ? (
            <DepositForm bankAccounts={activeBanks} />
          ) : (
            <p className="muted">{canFund ? "Link a bank account first." : "Available after identity verification."}</p>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section__heading">
          <h2>Deposits</h2>
        </div>
        {view.transfers.length === 0 ? (
          <EmptyState title="No deposits yet" detail="Your first deposit will appear here with each step — pending at the bank, then settled to cash — as it happens." />
        ) : (
          <ul className="transfer-list">
            {view.transfers.map((transfer) => (
              <li key={transfer.id} className="transfer">
                <div className="transfer__summary">
                  <div>
                    <strong>
                      <Money cents={cents(transfer.amountCents)} />
                    </strong>
                    <span className="muted">
                      {transfer.direction === "deposit" ? "Deposit" : "Withdrawal"}
                      {transfer.bankAccount ? ` from ${transfer.bankAccount.institutionName} ····${transfer.bankAccount.accountMask}` : ""} · <Timestamp value={transfer.createdAt} />
                    </span>
                  </div>
                  <StatusPill tone={transferStatusTone(transfer.status)}>{transferStatusLabel(transfer.status)}</StatusPill>
                </div>
                <Timeline
                  steps={transfer.timeline.map((step) => ({
                    key: step.step,
                    label: step.state === "failed" ? "Returned by bank" : depositStepLabel(step.step),
                    state: step.state,
                    detail: step.at ? <Timestamp value={step.at} /> : step.state === "current" ? "Waiting for the bank" : undefined,
                  }))}
                />
                {transfer.status === "returned" ? (
                  <InlineAlert tone="negative" title="This deposit was returned">
                    Your bank returned the transfer{transfer.returnCode ? ` (code ${transfer.returnCode})` : ""}. The amount has been taken back out of your cash. Check the account and try again, or use a different bank.
                  </InlineAlert>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
