import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Brand } from "../../components/Brand";
import { CorgiField } from "../../components/CorgiField";
import { SignInForm } from "../../components/SignInForm";
import { readSessionToken } from "../../server/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ reason?: string }>;
}) {
  if (await readSessionToken()) redirect("/overview");
  const { reason } = await searchParams;

  return (
    <main className="entry entry--signin">
      <header className="entry__nav">
        <Brand serif />
        <nav aria-label="Primary">
          <Link href="/sign-up" className="entry__signin">
            Create an account
          </Link>
        </nav>
      </header>
      <section className="entry__grid">
        <div className="entry__copy entry__copy--form">
          <h1>Welcome back.</h1>
          <p className="entry__lead">Sign in to see your portfolio, cash, and every change on the books.</p>
          <SignInForm expired={reason === "expired"} />
        </div>
        <div className="entry__art" aria-hidden="true">
          <CorgiField animate inkVar="--ink-strong" className="entry__canvas" />
        </div>
      </section>
    </main>
  );
}
