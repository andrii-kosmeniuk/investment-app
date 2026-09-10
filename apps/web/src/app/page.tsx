import Link from "next/link";

const capabilities = [
  "Identity verification",
  "Linked-bank funding",
  "Model portfolios",
  "Versioned performance",
] as const;

export default function HomePage() {
  return (
    <main className="entry">
      <nav className="entry__nav" aria-label="Primary">
        <Link href="/" className="wordmark">Corgi Invest</Link>
        <Link href="/ops" className="text-link">Operations</Link>
      </nav>

      <section className="entry__body">
        <div>
          <h1>Your investment history should never disappear.</h1>
          <p className="entry__lead">
            Fund a diversified model portfolio and see exactly what changed,
            when it changed, and what was known at the time.
          </p>
          <Link href="/portfolio" className="primary-action">Open demo portfolio</Link>
        </div>

        <ol className="capability-list">
          {capabilities.map((capability, index) => (
            <li key={capability}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {capability}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
