import { Money, StatusPill, Timestamp, Units } from "@corgi/ui";
import Link from "next/link";

export default function OperationsPage() {
  return (
    <main className="ops-shell" data-theme="ops">
      <aside>
        <Link href="/" className="wordmark">Corgi Invest</Link>
        <nav aria-label="Operations">
          <Link aria-current="page" href="/ops">Overview</Link>
          <Link href="/ops/approvals">Approvals <span>2</span></Link>
          <Link href="/ops/reconciliation">Reconciliation <span>1</span></Link>
          <Link href="/ops/events">Provider events</Link>
          <Link href="/ops/customers">Customers</Link>
          <Link href="/ops/live-fire">Live fire</Link>
        </nav>
      </aside>
      <section className="ops-content">
        <header>
          <div>
            <h1>Operational truth</h1>
            <p><Timestamp value="2026-09-10T10:02:00-04:00" /> · all jobs current</p>
          </div>
          <StatusPill tone="positive">4 providers healthy</StatusPill>
        </header>

        <div className="ops-metrics">
          <div><span>Pending approvals</span><strong>2</strong></div>
          <div><span>Open breaks</span><strong>1</strong></div>
          <div><span>Events today</span><strong>47</strong></div>
          <div><span>Ledger chain</span><strong>Valid</strong></div>
        </div>

        <section className="break-list">
          <div className="section-heading">
            <h2>Reconciliation breaks</h2>
            <Link href="/ops/reconciliation">View run</Link>
          </div>
          <article className="break-row">
            <div>
              <StatusPill tone="warning">Position · 0 days</StatusPill>
              <strong>VTI · Olivia Martin</strong>
              <span>Custodian file differs from the ledger</span>
            </div>
            <div><span>Ledger</span><Units micro={2_864_120n} /></div>
            <div><span>Custodian</span><Units micro={2_865_120n} /></div>
            <div><span>Difference</span><Units micro={1_000n} /></div>
          </article>
        </section>

        <section className="approval-list">
          <div className="section-heading"><h2>Awaiting a second operator</h2></div>
          <article className="approval-row">
            <div><strong>Withdrawal · Olivia Martin</strong><span>Requested by Sam Chen · 8 min ago</span></div>
            <Money cents={150_000n} />
            <button type="button">Review request</button>
          </article>
        </section>
      </section>
    </main>
  );
}
