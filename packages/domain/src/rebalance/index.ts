import { allocateLargestRemainder } from "../money/index.js";

export interface ModelTarget {
  readonly symbol: string;
  readonly weightBps: number;
  readonly minimumTradeCents: bigint;
  readonly fractionalAllowed: boolean;
}

export interface RebalanceLeg {
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly notionalCents: bigint;
  readonly targetWeightBps: number;
  readonly currentWeightBps: number;
}

export function proposeRebalance(input: {
  readonly portfolioValueCents: bigint;
  readonly cashBufferBps: number;
  readonly currentValues: ReadonlyMap<string, bigint>;
  readonly targets: readonly ModelTarget[];
}): readonly RebalanceLeg[] {
  const investable =
    (input.portfolioValueCents * BigInt(10_000 - input.cashBufferBps)) / 10_000n;
  const allocations = allocateLargestRemainder(
    investable,
    input.targets.map((target) => ({
      key: target.symbol,
      weight: BigInt(target.weightBps),
    })),
  );

  return input.targets.flatMap((target) => {
    const current = input.currentValues.get(target.symbol) ?? 0n;
    const desired = allocations.get(target.symbol) ?? 0n;
    const delta = desired - current;
    const absolute = delta < 0n ? -delta : delta;
    if (absolute < target.minimumTradeCents) return [];
    return [{
      symbol: target.symbol,
      side: delta > 0n ? "buy" as const : "sell" as const,
      notionalCents: absolute,
      targetWeightBps: target.weightBps,
      currentWeightBps:
        input.portfolioValueCents === 0n
          ? 0
          : Number((current * 10_000n) / input.portfolioValueCents),
    }];
  });
}
