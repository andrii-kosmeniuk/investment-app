export type ActorType = "human" | "agent";
export type ApprovalKind = "withdrawal" | "order" | "rebalance" | "recon_adjustment";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface ApprovalRequest {
  readonly id: string;
  readonly kind: ApprovalKind;
  readonly amountCents: bigint;
  readonly requestedByActorId: string;
  readonly requestedByActorType: ActorType;
  readonly status: ApprovalStatus;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ApprovalDecision {
  readonly requestId: string;
  readonly decidedByActorId: string;
  readonly decidedByActorType: ActorType;
  readonly decision: "approved" | "rejected";
  readonly reason: string;
}

export class InvalidApprovalError extends Error {
  override readonly name = "InvalidApprovalError";
}

export function assertValidDecision(
  request: ApprovalRequest,
  decision: ApprovalDecision,
): void {
  if (request.status !== "pending") {
    throw new InvalidApprovalError("Only pending requests may be decided");
  }
  if (decision.decidedByActorType !== "human") {
    throw new InvalidApprovalError("Autonomous agents cannot approve or reject requests");
  }
  if (request.requestedByActorId === decision.decidedByActorId) {
    throw new InvalidApprovalError("Initiators cannot decide their own requests");
  }
}
