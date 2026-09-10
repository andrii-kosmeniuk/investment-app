"use client";

import { useEffect, useRef } from "react";

/**
 * A fern rendered as a field of monospace characters (design brief §4,
 * "secondary asset"). Density → glyph ramp; single ink on the page surface.
 * With `animate`, the fern sways in a slow breeze at ~10 fps so the motion
 * reads as stepped glyphs rather than a smooth tween. Static under
 * prefers-reduced-motion and while off-screen.
 */

const RAMP = " ·.:-=+*%#@";
const FRAME_MS = 100;

type Props = {
  readonly inkVar?: string;
  readonly animate?: boolean;
  readonly className?: string;
};

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Stem centre line; the breeze bends the top more than the base. */
function stemX(ny: number, wind: number): number {
  const lean = 1 - ny; // 0 at the base (bottom), 1 at the tip (top)
  return 0.5 + 0.05 * Math.sin(ny * 3.4) + wind * lean * lean;
}

/** Density in [0, 1] of a fern at normalised coordinates, at time `t`. */
function fern(nx: number, ny: number, t: number): number {
  let density = 0;
  const wind = 0.035 * Math.sin(t * 0.7) + 0.012 * Math.sin(t * 1.9 + 1.3);
  const sx = stemX(ny, wind);
  if (ny > 0.08 && ny < 0.96 && Math.abs(nx - sx) < 0.011) density = 0.9;

  const fronds = 9;
  for (let index = 0; index < fronds; index += 1) {
    const y = 0.16 + (index / (fronds - 1)) * 0.72;
    const taper = 1 - Math.abs(y - 0.52) * 1.35;
    const length = 0.4 * Math.max(0.25, taper);
    const width = length * 0.32;
    const flutter = 0.07 * Math.sin(t * 1.1 + index * 0.8) + wind * 1.4;
    for (const direction of [-1, 1] as const) {
      const dx = nx - stemX(y, wind);
      const dy = ny - y;
      const angle = direction * -0.62 + flutter;
      const u = dx * Math.cos(angle) + dy * Math.sin(angle);
      const v = -dx * Math.sin(angle) + dy * Math.cos(angle);
      if (u * direction <= 0) continue;
      const along = Math.abs(u) / length;
      const across = Math.abs(v) / (width * (1 - along * 0.85));
      const inside = along * along + across * across;
      if (inside < 1) {
        const veins = 0.55 + 0.45 * (Math.sin(along * 42) > 0.2 ? 1 : 0.35);
        density = Math.max(density, (1 - inside) * veins);
      }
    }
  }
  return Math.min(1, density);
}

export function CharacterField({ inkVar = "--ink-strong", animate = false, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const moving = animate && !reduced;
    let t = 0;
    let visible = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const styles = getComputedStyle(canvas);
      const ink = styles.getPropertyValue(inkVar).trim() || "#202620";
      const font = styles.getPropertyValue("--font-code").trim() || "monospace";
      const glyph = 11;
      const columns = Math.floor(width / (glyph * 0.62));
      const rows = Math.floor(height / (glyph * 1.15));

      context.clearRect(0, 0, width, height);
      context.fillStyle = ink;
      context.font = `${glyph}px ${font}`;
      context.textBaseline = "top";

      for (let row = 0; row < rows; row += 1) {
        const ny = (row + 0.5) / rows;
        for (let column = 0; column < columns; column += 1) {
          const nx = (column + 0.5) / columns;
          const density = fern(nx, ny, t);
          if (density < 0.03) continue;
          const jitter = (hash(column, row) - 0.5) * 0.18;
          const index = Math.min(RAMP.length - 1, Math.max(1, Math.round((density + jitter) * (RAMP.length - 1))));
          context.globalAlpha = 0.55 + 0.45 * density;
          context.fillText(RAMP[index] ?? "·", column * glyph * 0.62, row * glyph * 1.15);
        }
      }
      context.globalAlpha = 1;
    };

    const loop = () => {
      if (!moving || !visible) return;
      t += FRAME_MS / 1000;
      render();
      timer = setTimeout(loop, FRAME_MS);
    };

    render();
    const resize = new ResizeObserver(() => render());
    resize.observe(canvas);

    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (timer) clearTimeout(timer);
      if (visible) loop();
    });
    intersection.observe(canvas);

    return () => {
      if (timer) clearTimeout(timer);
      resize.disconnect();
      intersection.disconnect();
    };
  }, [inkVar, animate]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
