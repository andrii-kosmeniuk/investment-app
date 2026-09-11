import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "../../components/Brand";
import { CorgiField } from "../../components/CorgiField";
import { SignUpForm } from "../../components/SignUpForm";
import { readSessionToken } from "../../server/session";

export const metadata: Metadata = { title: "Create an account" };

export default async function SignUpPage() {
  if (await readSessionToken()) redirect("/overview");

  return (
    <main className="entry entry--signin">
      <header className="entry__nav">
        <Brand serif />
        <nav aria-label="Primary">
          <Link href="/sign-in" className="entry__signin">
            Sign in
          </Link>
        </nav>
      </header>
      <section className="entry__grid">
        <div className="entry__copy entry__copy--form">
          <h1>Start with your name.</h1>
          <p className="entry__lead">
            An account lets you look around. Before any money moves you will verify your identity, link a bank, and add
            cash — in that order, each confirmed by the provider.
          </p>
          <SignUpForm />
        </div>
        <div className="entry__art" aria-hidden="true">
          <CorgiField animate inkVar="--ink-strong" className="entry__canvas" />
        </div>
      </section>
    </main>
  );
}
