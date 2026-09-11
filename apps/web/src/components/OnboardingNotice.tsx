"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { StatusPill } from "@corgi/ui";
import type { OnboardingNotice as Notice } from "../lib/onboarding-notice";

/**
 * Shell-wide band that names the next onboarding step until the rail is
 * complete (ADR-0006). It stays out of the way on the onboarding page itself,
 * where the full rail already is.
 */
export function OnboardingNotice({ notice }: { readonly notice: Notice }) {
  const pathname = usePathname();
  if (pathname === "/onboarding" || pathname.startsWith("/onboarding/")) return null;

  return (
    <aside className="shell__notice" data-tone={notice.tone} aria-label="Onboarding">
      <div className="shell__notice-body">
        <p className="shell__notice-title">
          <strong>{notice.title}</strong>
          <StatusPill tone={notice.tone === "negative" ? "negative" : "warning"}>{notice.status}</StatusPill>
        </p>
        <p>
          {notice.detail} {notice.progress}.
        </p>
      </div>
      {notice.action ? (
        <Link href={notice.action.href} className="button" data-variant={notice.tone === "negative" ? "secondary" : "primary"}>
          <span className="button__label">{notice.action.label}</span>
        </Link>
      ) : null}
    </aside>
  );
}
