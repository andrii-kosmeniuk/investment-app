"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV_ITEMS = [
  { href: "/overview", label: "Overview" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/performance", label: "Performance" },
  { href: "/activity", label: "Activity" },
  { href: "/transfers", label: "Transfers" },
  { href: "/onboarding", label: "Onboarding" },
] as const;

/**
 * Sidebar on desktop, bottom bar on mobile (design brief §9.2). `attention`
 * names the one item that still needs the customer (the onboarding rail while
 * it is incomplete); it is marked with a dot and spoken text, not colour alone.
 */
export function ShellNav({ variant, attention = null }: { readonly variant: "side" | "bottom"; readonly attention?: string | null }) {
  const pathname = usePathname();
  return (
    <nav className={`shell-nav shell-nav--${variant}`} aria-label={variant === "side" ? "Primary" : "Primary (mobile)"}>
      {NAV_ITEMS.map((item) => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const flagged = attention === item.href;
        return (
          <Link key={item.href} href={item.href} aria-current={current ? "page" : undefined} data-attention={flagged ? "true" : undefined}>
            {item.label}
            {flagged ? <span className="visually-hidden"> (action needed)</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
