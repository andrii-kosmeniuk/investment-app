export const duration = {
  fast: 0.12,
  base: 0.2,
  slow: 0.32,
  chart: 0.6,
} as const;

export const easing = {
  enter: [0.2, 0.8, 0.2, 1],
  exit: [0.4, 0, 1, 1],
} as const;

export const motionVariants = {
  fadeRise: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 4 },
  },
  pillSwap: {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
  },
} as const;

export function rowStagger(index: number): number {
  return Math.min(index, 7) * 0.02;
}
