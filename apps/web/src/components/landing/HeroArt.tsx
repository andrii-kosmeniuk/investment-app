import Image from "next/image";

/**
 * The cut-out corgi piggy bank, alone on the page canvas. Shared by the
 * landing hero and both auth pages so the entry surfaces read as one place.
 */
export function HeroArt({ priority = false, className }: { readonly priority?: boolean; readonly className?: string }) {
  return (
    <div className={["hero-art", className].filter(Boolean).join(" ")} aria-hidden="true">
      <Image
        src="/hero-corgi-cutout.png"
        alt=""
        width={547}
        height={456}
        priority={priority}
        sizes="(min-width: 106.25rem) 44rem, (min-width: 81.25rem) 56rem, (min-width: 65rem) 30rem, 80vw"
        className="hero-art__corgi"
      />
    </div>
  );
}
