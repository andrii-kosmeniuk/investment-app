export interface DailyPerformance {
  readonly openingValue: bigint;
  readonly closingValue: bigint;
  /** External cash flows are weighted as beginning-of-day flows. */
  readonly externalFlow: bigint;
}

export function timeWeightedReturn(days: readonly DailyPerformance[]): number {
  let linked = 1;
  for (const day of days) {
    if (day.openingValue === 0n) continue;
    linked *=
      1 +
      Number(day.closingValue - day.externalFlow - day.openingValue) /
        Number(day.openingValue);
  }
  return linked - 1;
}

export interface WeightedFlow {
  readonly amount: bigint;
  /** Fraction of period remaining when the flow occurred, between 0 and 1. */
  readonly weight: number;
}

export function modifiedDietzReturn(
  openingValue: bigint,
  closingValue: bigint,
  flows: readonly WeightedFlow[],
): number | null {
  const netFlows = flows.reduce((sum, flow) => sum + flow.amount, 0n);
  const weightedFlows = flows.reduce(
    (sum, flow) => sum + Number(flow.amount) * flow.weight,
    0,
  );
  const denominator = Number(openingValue) + weightedFlows;
  if (denominator === 0) return null;
  return (Number(closingValue - openingValue - netFlows)) / denominator;
}
