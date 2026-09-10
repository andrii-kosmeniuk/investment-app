import Link from "next/link";

/** 8×8 pixel emblem — the one place the brand orange appears as a mark. */
export function Emblem({ size = 20 }: { readonly size?: number }) {
  return (
    <svg className="emblem" viewBox="0 0 8 8" width={size} height={size} aria-hidden="true" shapeRendering="crispEdges">
      <path
        fill="currentColor"
        d="M3 0h2v1H3zM2 1h1v1H2zM5 1h1v1H5zM1 2h1v1H1zM6 2h1v1H6zM0 3h1v2H0zM7 3h1v2H7zM3 3h2v2H3zM1 5h1v1H1zM6 5h1v1H6zM2 6h1v1H2zM5 6h1v1H5zM3 7h2v1H3z"
      />
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
