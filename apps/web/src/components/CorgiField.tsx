"use client";

import { useEffect, useRef } from "react";

/**
 * Flying corgi rendered as a monospace character field — a nod to the Corgi
 * brand mark, stepped at ~10 fps. Two cape frames and a gentle vertical bob
 * suggest flight without smooth tweening. Static under prefers-reduced-motion.
 */

const RAMP = " ·.:-=+*%#@";
const FRAME_MS = 100;
const SPRITE_W = 32;
const SPRITE_H = 22;

const BLANK = "0".repeat(SPRITE_W);

function paint(rows: readonly string[], edits: readonly [row: number, col: number, value: string][]) {
  const copy = rows.map((row) => row.split(""));
  for (const [row, col, value] of edits) copy[row]![col] = value;
  return copy.map((row) => row.join(""));
}

const CORGI = Array.from({ length: SPRITE_H }, () => BLANK);

/** Frame A — cape lifted */
const FRAME_A = paint(CORGI, [
  [3, 18, "2"], [3, 19, "2"], [3, 20, "2"], [3, 21, "2"], [3, 22, "2"], [3, 23, "2"],
  [4, 17, "2"], [4, 18, "2"], [4, 19, "2"], [4, 20, "2"], [4, 21, "2"], [4, 22, "2"], [4, 23, "2"], [4, 24, "2"],
  [5, 16, "2"], [5, 17, "2"], [5, 18, "2"], [5, 19, "2"], [5, 20, "2"], [5, 21, "2"],
  [6, 15, "1"], [6, 16, "1"], [6, 17, "1"], [6, 18, "3"], [6, 19, "1"], [6, 20, "1"],
  [7, 14, "1"], [7, 15, "1"], [7, 16, "3"], [7, 17, "3"], [7, 18, "1"], [7, 19, "1"], [7, 20, "1"],
  [8, 13, "1"], [8, 14, "1"], [8, 15, "1"], [8, 16, "1"], [8, 17, "1"], [8, 18, "1"], [8, 19, "1"],
  [9, 12, "1"], [9, 13, "1"], [9, 14, "1"], [9, 15, "1"], [9, 16, "1"], [9, 17, "1"], [9, 18, "1"], [9, 19, "1"],
  [10, 11, "1"], [10, 12, "1"], [10, 13, "1"], [10, 14, "3"], [10, 15, "3"], [10, 16, "1"], [10, 17, "1"], [10, 18, "1"],
  [11, 10, "1"], [11, 11, "1"], [11, 12, "1"], [11, 13, "1"], [11, 14, "1"], [11, 15, "1"], [11, 16, "1"], [11, 17, "1"],
  [12, 9, "1"], [12, 10, "1"], [12, 11, "1"], [12, 12, "1"], [12, 13, "1"], [12, 14, "1"], [12, 15, "1"],
  [13, 8, "1"], [13, 9, "1"], [13, 10, "1"], [13, 11, "1"], [13, 12, "1"], [13, 13, "1"], [13, 14, "1"],
  [14, 7, "1"], [14, 8, "1"], [14, 9, "1"], [14, 10, "1"], [14, 11, "1"], [14, 12, "1"],
  [15, 6, "1"], [15, 7, "1"], [15, 8, "1"], [15, 9, "1"], [15, 10, "1"],
  [16, 5, "1"], [16, 6, "1"], [16, 7, "1"], [16, 8, "1"],
  [17, 4, "1"], [17, 5, "1"], [17, 6, "1"],
  [18, 3, "1"], [18, 4, "1"], [18, 5, "1"],
  [19, 2, "1"], [19, 3, "1"], [19, 4, "1"],
  [20, 1, "1"], [20, 2, "1"], [20, 3, "1"],
  [21, 0, "1"], [21, 1, "1"], [21, 2, "1"],
]);

/** Frame B — cape dipped */
const FRAME_B = paint(CORGI, [
  [4, 19, "2"], [4, 20, "2"], [4, 21, "2"], [4, 22, "2"], [4, 23, "2"], [4, 24, "2"], [4, 25, "2"],
  [5, 18, "2"], [5, 19, "2"], [5, 20, "2"], [5, 21, "2"], [5, 22, "2"], [5, 23, "2"], [5, 24, "2"],
  [6, 17, "2"], [6, 18, "2"], [6, 19, "2"], [6, 20, "2"], [6, 21, "2"],
  [7, 15, "1"], [7, 16, "1"], [7, 17, "1"], [7, 18, "3"], [7, 19, "1"], [7, 20, "1"],
  [8, 14, "1"], [8, 15, "1"], [8, 16, "3"], [8, 17, "3"], [8, 18, "1"], [8, 19, "1"], [8, 20, "1"],
  [9, 13, "1"], [9, 14, "1"], [9, 15, "1"], [9, 16, "1"], [9, 17, "1"], [9, 18, "1"], [9, 19, "1"],
  [10, 12, "1"], [10, 13, "1"], [10, 14, "1"], [10, 15, "1"], [10, 16, "1"], [10, 17, "1"], [10, 18, "1"], [10, 19, "1"],
  [11, 11, "1"], [11, 12, "1"], [11, 13, "1"], [11, 14, "3"], [11, 15, "3"], [11, 16, "1"], [11, 17, "1"], [11, 18, "1"],
  [12, 10, "1"], [12, 11, "1"], [12, 12, "1"], [12, 13, "1"], [12, 14, "1"], [12, 15, "1"], [12, 16, "1"], [12, 17, "1"],
  [13, 9, "1"], [13, 10, "1"], [13, 11, "1"], [13, 12, "1"], [13, 13, "1"], [13, 14, "1"], [13, 15, "1"],
  [14, 8, "1"], [14, 9, "1"], [14, 10, "1"], [14, 11, "1"], [14, 12, "1"], [14, 13, "1"], [14, 14, "1"],
  [15, 7, "1"], [15, 8, "1"], [15, 9, "1"], [15, 10, "1"], [15, 11, "1"], [15, 12, "1"],
  [16, 6, "1"], [16, 7, "1"], [16, 8, "1"], [16, 9, "1"], [16, 10, "1"],
  [17, 5, "1"], [17, 6, "1"], [17, 7, "1"], [17, 8, "1"],
  [18, 4, "1"], [18, 5, "1"], [18, 6, "1"],
  [19, 3, "1"], [19, 4, "1"], [19, 5, "1"],
  [20, 2, "1"], [20, 3, "1"], [20, 4, "1"],
  [21, 1, "1"], [21, 2, "1"], [21, 3, "1"],
]);

const FRAMES = [FRAME_A, FRAME_B] as const;

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

function densityAt(frame: readonly string[], sx: number, sy: number): number {
  const col = Math.floor(sx * SPRITE_W);
  const row = Math.floor(sy * SPRITE_H);
  if (col < 0 || col >= SPRITE_W || row < 0 || row >= SPRITE_H) return 0;
  const cell = frame[row]?.[col] ?? "0";
  if (cell === "0") return 0;
  if (cell === "3") return 0.35;
  if (cell === "2") return 0.72;
  return 0.92;
}

export function CorgiField({ inkVar = "--ink-strong", animate = false, className }: Props) {
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

      const bob = moving ? Math.sin(t * 1.4) * 0.04 : 0;
      const frameIndex = moving ? Math.floor(t * 3) % FRAMES.length : 0;
      const frame = FRAMES[frameIndex] ?? FRAME_A;

      const scale = Math.min(1.35 / columns, 1.1 / rows) * Math.min(columns, rows) * 0.85;
      const originX = 0.52;
      const originY = 0.48 + bob;

      context.clearRect(0, 0, width, height);
      context.fillStyle = ink;
      context.font = `${glyph}px ${font}`;
      context.textBaseline = "top";

      for (let row = 0; row < rows; row += 1) {
        const ny = (row + 0.5) / rows;
        for (let column = 0; column < columns; column += 1) {
          const nx = (column + 0.5) / columns;
          const sx = (nx - originX) / scale + 0.5;
          const sy = (ny - originY) / scale + 0.5;
          const density = densityAt(frame, sx, sy);
          if (density < 0.03) continue;
          const jitter = (hash(column, row) - 0.5) * 0.14;
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
