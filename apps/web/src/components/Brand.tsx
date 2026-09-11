import Link from "next/link";

/** 8×8 pixel emblem — diamond outline with a 2×2 centre block. Render at 16 or 24 px. */
const EMBLEM_PIXELS = [
  "00111100",
  "01100110",
  "11000011",
  "11001111",
  "11001111",
  "11000011",
  "01100110",
  "00111100",
] as const;

export function Emblem({ size = 16 }: { readonly size?: number }) {
  return (
    <svg
      className="emblem"
      viewBox="0 0 8 8"
      width={size}
      height={size}
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {EMBLEM_PIXELS.flatMap((row, y) =>
        [...row].flatMap((cell, x) =>
          cell === "1" ? [<rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />] : [],
        ),
      )}
    </svg>
  );
}

export function Brand({ href = "/", serif = false }: { readonly href?: string; readonly serif?: boolean }) {
  return (
    <Link href={href} className={serif ? "brand brand--serif" : "brand"}>
      <Emblem />
      Corgi Invest
    </Link>
  );
}
