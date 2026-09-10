"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export const NAV_ITEMS = [
  { href: "/overview", label: "Overview" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/activity", label: "Activity" },
  { href: "/transfers", label: "Transfers" },
  { href: "/onboarding", label: "Onboarding" },
] as const;

/** Sidebar on desktop, bottom bar on mobile (design brief §9.2). */
export function ShellNav({ variant }: { readonly variant: "side" | "bottom" }) {
  const pathname = usePathname();
  return (
    <nav className={`shell-nav shell-nav--${variant}`} aria-label={variant === "side" ? "Primary" : "Primary (mobile)"}>
      {NAV_ITEMS.map((item) => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href} aria-current={current ? "page" : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
