import Image from "next/image";
import type { ReactNode } from "react";
import { HeroArt } from "./HeroArt";

/** Sign-in and sign-up share the landing hero: cloudy field, left veil, corgi on the right. */
export function AuthHeroSection({ children }: { readonly children: ReactNode }) {
  return (
    <section className="entry__grid entry__hero entry__hero--auth">
      <Image
        src="/hero-field.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        quality={92}
        className="entry__hero-bg"
        aria-hidden="true"
      />
      {children}
      <HeroArt priority className="entry__hero-art" />
    </section>
  );
}
