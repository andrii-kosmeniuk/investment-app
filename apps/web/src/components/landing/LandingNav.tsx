"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { LANDING_SECTIONS } from "../../lib/landing-copy";
import { Brand } from "../Brand";

/**
 * Sticky entry header. On wide screens the section links sit inline; under
 * 65rem they fold into a menu behind the button in the upper-right corner.
 * The menu is a plain dropdown (no focus trap) that closes on Escape, on any
 * link, and on an outside click.
 */
export function LandingNav() {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header ref={rootRef} className="landing__header" data-open={open ? "true" : undefined}>
      <Brand serif />

      <nav aria-label="Sections" className="landing__links">
        {LANDING_SECTIONS.map((section) => (
          <a key={section.id} href={`#${section.id}`}>
            {section.label}
          </a>
        ))}
      </nav>

      {/* One primary action per decision area: the orange pill lives in the hero, not here. */}
      <div className="landing__auth">
        <Link href="/sign-up" className="button" data-variant="primary">
          <span className="button__label">Create an account</span>
        </Link>
        <Link href="/sign-in" className="entry__signin">
          Sign in
        </Link>
      </div>

      <button
        type="button"
        className="landing__burger"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
          <path className="landing__burger-line" d="M3 7h18" />
          <path className="landing__burger-line" d="M3 12h18" />
          <path className="landing__burger-line" d="M3 17h18" />
        </svg>
      </button>

      <nav id={menuId} className="landing__menu" aria-label="Sections (menu)" hidden={!open}>
        <div className="landing__menu-sections">
          {LANDING_SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`} onClick={close}>
              {section.label}
            </a>
          ))}
        </div>
        <div className="landing__menu-auth">
          <Link href="/sign-up" onClick={close} className="button" data-variant="primary">
            <span className="button__label">Create an account</span>
          </Link>
          <Link href="/sign-in" className="entry__signin" onClick={close}>
            Sign in
          </Link>
        </div>
      </nav>
    </header>
  );
}
