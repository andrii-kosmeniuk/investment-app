import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "../components/Brand";
import { CharacterField } from "../components/CharacterField";
import { readSessionToken } from "../server/session";

const facts = [
  "Identity verification before any money moves",
  "Deposits from a linked bank account",
  "Four model portfolios, rebalanced monthly",
  "Returns restated, never rewritten",
] as const;

export default async function EntryPage() {
  if (await readSessionToken()) redirect("/overview");

  return (
    <main className="entry">
      <header className="entry__nav">
        <Brand serif />
        <nav aria-label="Primary">
          <Link href="/sign-in" className="entry__signin">
            Sign in
          </Link>
        </nav>
      </header>

      <section className="entry__grid">
        <div className="entry__copy">
          <h1>A clearer view of your investments.</h1>
          <p className="entry__lead">
            Fund a model portfolio from your bank, watch every order land, and see exactly what
            changed, when, and what was known at the time.
          </p>
          <div className="entry__actions">
            <Link href="/sign-in" className="button" data-variant="primary">
              <span className="button__label">Sign in to your account</span>
            </Link>
          </div>
        </div>
        <div className="entry__art" aria-hidden="true">
          <CharacterField animate inkVar="--ink-strong" className="entry__canvas" />
        </div>
      </section>

      <ol className="entry__facts">
        {facts.map((fact, index) => (
          <li key={fact}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            {fact}
          </li>
        ))}
      </ol>
    </main>
  );
}
