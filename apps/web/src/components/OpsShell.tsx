import Link from "next/link";
import type { ReactNode } from "react";

export const OPS_NAV = [
  { href: "/ops", label: "Overview" },
  { href: "/ops/restatements", label: "Restatements" },
  { href: "/ops/live-fire", label: "Live fire" },
] as const;

/** Operations chrome: dense, neutral, and visibly not the customer app (design brief §9.3). */
export function OpsShell({ current, children, account }: { readonly current: string; readonly children: ReactNode; readonly account?: ReactNode }) {
  return (
    <main className="ops-shell" data-theme="ops">
      <aside>
        <Link href="/" className="wordmark">
          Corgi Invest
        </Link>
        <nav aria-label="Operations">
          {OPS_NAV.map((item) => (
            <Link key={item.href} href={item.href} aria-current={item.href === current ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
        </nav>
        {account ? <div className="ops-shell__account">{account}</div> : null}
      </aside>
      <section className="ops-content">{children}</section>
    </main>
  );
}
