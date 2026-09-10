export const orderStates = [
  "draft",
  "pending_approval",
  "approved",
  "submitted",
  "queued_for_open",
  "accepted",
  "partially_filled",
  "filled",
  "cancelled",
  "rejected",
  "expired",
] as const;

export type OrderState = (typeof orderStates)[number];

const transitions: Readonly<Record<OrderState, readonly OrderState[]>> = {
  draft: ["pending_approval", "approved", "cancelled"],
  pending_approval: ["approved", "rejected", "cancelled"],
  approved: ["submitted", "cancelled"],
  submitted: ["queued_for_open", "accepted", "partially_filled", "filled", "rejected"],
  queued_for_open: ["accepted", "partially_filled", "filled", "cancelled", "expired"],
  accepted: ["partially_filled", "filled", "cancelled", "rejected", "expired"],
  partially_filled: ["partially_filled", "filled", "cancelled", "expired"],
  filled: [],
  cancelled: [],
  rejected: [],
  expired: [],
};

export function canTransitionOrder(from: OrderState, to: OrderState): boolean {
  return transitions[from].includes(to);
}

export interface CumulativeFill {
  readonly executionId: string;
  readonly cumulativeUnits: bigint;
  readonly priceCents: bigint;
}

export function incrementalFillUnits(
  priorCumulativeUnits: bigint,
  update: CumulativeFill,
): bigint {
  return update.cumulativeUnits > priorCumulativeUnits
    ? update.cumulativeUnits - priorCumulativeUnits
    : 0n;
}
