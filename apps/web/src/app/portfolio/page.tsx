import { Money, Percentage, StatusPill, Timestamp, Units } from "@corgi/ui";
import Link from "next/link";

const positions = [
  { symbol: "VTI", name: "US Total Stock Market", units: 2_864_120n, value: 82_140n, gain: 0.0341 },
  { symbol: "VXUS", name: "International Stocks", units: 4_105_410n, value: 24_610n, gain: -0.0082 },
  { symbol: "BND", name: "US Aggregate Bonds", units: 3_402_000n, value: 25_230n, gain: 0.0124 },
] as const;

export default function PortfolioPage() {
  return (
    <main className="workspace">
      <header className="workspace__header">
        <Link href="/" className="wordmark">Corgi Invest</Link>
        <nav aria-label="Portfolio">
          <Link aria-current="page" href="/portfolio">Portfolio</Link>
          <Link href="/activity">Activity</Link>
          <Link href="/statements">Statements</Link>
          <Link href="/tax">Tax</Link>
        </nav>
      </header>

      <section className="portfolio-heading">
        <div>
          <p className="label">Portfolio value</p>
          <h1><Money cents={134_820n} /></h1>
          <p className="as-of">As of <Timestamp value="2026-09-09T20:00:00Z" /></p>
        </div>
        <div className="return-block">
          <p className="label">Time-weighted return · 1 month</p>
          <strong><Percentage value={0.0218} /></strong>
          <StatusPill tone="info">Restated Sep 10 · was +2.11%</StatusPill>
        </div>
      </section>

      <section className="cash-strip" aria-label="Cash availability">
        <div><span>Settled</span><Money cents={2_840n} /></div>
        <div><span>Available to trade</span><Money cents={2_840n} /></div>
        <div><span>Pending</span><Money cents={0n} /></div>
        <div><span>Withdrawable</span><Money cents={2_840n} /></div>
      </section>

      <section className="positions">
        <div className="section-heading">
          <h2>Positions</h2>
          <span>Balanced growth · 1% cash buffer</span>
        </div>
        <div className="positions__header" aria-hidden="true">
          <span>Holding</span><span>Units</span><span>Value</span><span>Return</span>
        </div>
        {positions.map((position) => (
          <article className="position-row" key={position.symbol}>
            <div><strong>{position.symbol}</strong><span>{position.name}</span></div>
            <Units micro={position.units} />
            <Money cents={position.value} />
            <Percentage value={position.gain} />
          </article>
        ))}
      </section>
    </main>
  );
}
