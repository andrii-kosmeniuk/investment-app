"use client";

import Image from "next/image";
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface PlateFigure {
  /** File stem under `/plates/`; `<stem>-a.png` and `<stem>-b.png` are the two pre-dithered frames. */
  readonly stem: string;
  /** What the figure shows, for the field-guide caption line. */
  readonly subject: string;
  /** Intrinsic pixel size of the frames (exported at 2× display size). */
  readonly width: number;
  readonly height: number;
  /** A single still image (public path) instead of the two breathing frames. */
  readonly still?: string;
}

type InView = "pending" | "true";

/**
 * One field-guide plate: a dithered figure beside a caption block. The figure
 * "breathes" by cross-fading two frames dithered with a shifted threshold
 * (design brief §12): nothing moves, the texture drifts. The caption rises
 * into place once, when the plate first enters the viewport; the ink rule
 * above it draws in steps. Server markup carries no `data-inview`, so the
 * plate is fully visible without JavaScript and static under reduced motion.
 */
export function Plate({
  id,
  numeral,
  title,
  figure,
  flip = false,
  children,
}: {
  readonly id: string;
  readonly numeral: string;
  readonly title: string;
  readonly figure: PlateFigure;
  readonly flip?: boolean;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState<InView | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView("true");
          observer.disconnect();
        } else {
          setInView((current) => current ?? "pending");
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id={id}
      ref={ref}
      className="plate"
      data-flip={flip ? "true" : undefined}
      data-inview={inView ?? undefined}
      aria-labelledby={`${id}-title`}
    >
      <div className="plate__rule" aria-hidden="true" />
      <figure className="plate__figure">
        {figure.still ? (
          <div className="plate__frames plate__frames--still">
            <Image src={figure.still} alt="" width={figure.width} height={figure.height} className="plate__still" />
          </div>
        ) : (
          <div className="plate__frames">
            <Image
              src={`/plates/${figure.stem}-a.png`}
              alt=""
              width={figure.width}
              height={figure.height}
              unoptimized
              className="plate__frame plate__frame--a"
            />
            <Image
              src={`/plates/${figure.stem}-b.png`}
              alt=""
              width={figure.width}
              height={figure.height}
              unoptimized
              className="plate__frame plate__frame--b"
            />
          </div>
        )}
        <figcaption>
          Plate {numeral} · {figure.subject}
        </figcaption>
      </figure>
      <div className="plate__caption">
        <h2 id={`${id}-title`}>{title}</h2>
        {children}
      </div>
    </section>
  );
}
