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
        sizes="(min-width: 56rem) 40vw, 80vw"
        className="hero-art__corgi"
      />
    </div>
  );
}
