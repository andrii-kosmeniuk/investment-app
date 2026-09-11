import {
  type ApprovalDecision,
  type ApprovalKind,
  type ApprovalRequest,
  type RebalanceLeg,
  assertValidDecision,
} from "@corgi/domain";
import { NotFoundError, ValidationError } from "../errors.js";
import type {
  ActorDirectory,
  ActorRecord,
  ApprovalDecisionRecord,
  ApprovalRepository,
  ApprovalRequestRecord,
  Clock,
  IdGenerator,
} from "../ports.js";

/* ------------------------------------------------------------------ */
/* Payloads: the frozen instruction the checker approves               */
/* ------------------------------------------------------------------ */

export interface WithdrawalPayload {
  readonly customerId: string;
  readonly reason: string;
}

export interface OrderPayload {
  readonly customerId: string;
  readonly symbol: string;
  readonly side: "buy" | "sell";
  readonly notionalCents: string;
  /** Why the system filed it, e.g. `sell_to_cover` after a returned deposit. */
  readonly intent?: string;
  readonly returnCode?: string;
  readonly transferId?: string;
}

export interface RebalancePayload {
  readonly customerId: string;
  readonly reason: string;
  readonly asOfDate: string;
  readonly legs: readonly (Omit<RebalanceLeg, "notionalCents"> & { readonly notionalCents: string })[];
}

export interface ReconAdjustmentPayload {
  readonly breakId: string;
  readonly customerId: string;
  readonly category: "position_units" | "cash";
  readonly key: string;
  /** custodian − ledger, in micro-units or cents. */
  readonly delta: string;
  readonly note: string;
}

export interface ApprovalPayloads {
  readonly withdrawal: WithdrawalPayload;
  readonly order: OrderPayload;
  readonly rebalance: RebalancePayload;
  readonly recon_adjustment: ReconAdjustmentPayload;
}

export function payloadOf<K extends ApprovalKind>(request: ApprovalRequest, kind: K): ApprovalPayloads[K] {
  if (request.kind !== kind) throw new ValidationError(`Expected a ${kind} request, got ${request.kind}`);
  return request.payload as unknown as ApprovalPayloads[K];
}

/* ------------------------------------------------------------------ */
/* Deciding                                                             */
/* ------------------------------------------------------------------ */

/** What approving a request actually did; shown verbatim to the operator. */
export type ApprovalOutcome = Readonly<Record<string, string | number | boolean | null>>;

export type ApprovalExecutor = (request: ApprovalRequestRecord, decidedBy: ActorRecord) => Promise<ApprovalOutcome>;
export type ApprovalExecutors = Readonly<Record<ApprovalKind, ApprovalExecutor>>;

export interface DecideApprovalDeps {
  readonly approvals: ApprovalRepository;
  readonly actors: ActorDirectory;
  readonly executors: ApprovalExecutors;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface DecideApprovalCommand {
  readonly requestId: string;
  readonly actorId: string;
  readonly decision: "approved" | "rejected";
  readonly reason: string;
}

export interface DecideApprovalResult {
  readonly request: ApprovalRequestRecord;
  readonly decision: ApprovalDecisionRecord;
  readonly outcome: ApprovalOutcome | null;
}

/**
 * The single way a request leaves `pending`. Validates the decision against
 * the request (pending, human, maker ≠ checker), runs the kind's executor for
 * an approval, then records the decision. Executing before recording means
 * "approved" is only ever written when the effect succeeded; a failed executor
 * leaves the request pending and the error with the operator (ADR-0005).
 */
export async function decideApproval(deps: DecideApprovalDeps, command: DecideApprovalCommand): Promise<DecideApprovalResult> {
  const request = await deps.approvals.findById(command.requestId);
  if (!request) throw new NotFoundError("Approval request not found");
  const actor = await deps.actors.findById(command.actorId);
  if (!actor) throw new NotFoundError("Operator not found");
  if (command.reason.trim().length === 0) throw new ValidationError("A reason is required");

  const decision: ApprovalDecision = {
    requestId: request.id,
    decidedByActorId: actor.id,
    decidedByActorType: actor.actorType,
    decision: command.decision,
    reason: command.reason.trim(),
  };
  assertValidDecision(request, decision);

  const outcome = command.decision === "approved" ? await deps.executors[request.kind](request, actor) : null;

  const record: ApprovalDecisionRecord = { ...decision, id: deps.ids.next(), decidedAt: deps.clock.now() };
  await deps.approvals.recordDecision(record);
  return { request: { ...request, status: command.decision }, decision: record, outcome };
}

/* ------------------------------------------------------------------ */
/* Filing                                                               */
/* ------------------------------------------------------------------ */

export interface FileApprovalDeps {
  readonly approvals: ApprovalRepository;
  readonly ids: IdGenerator;
}

/** Files a pending request; the requester is whoever the caller resolved (customer, operator, agent, system). */
export async function fileApproval<K extends ApprovalKind>(
  deps: FileApprovalDeps,
  input: {
    kind: K;
    amountCents: bigint;
    payload: ApprovalPayloads[K];
    requestedBy: { id: string; actorType: ApprovalRequest["requestedByActorType"] };
  },
): Promise<ApprovalRequest> {
  const request: ApprovalRequest = {
    id: deps.ids.next(),
    kind: input.kind,
    amountCents: input.amountCents,
    payload: input.payload as unknown as Readonly<Record<string, unknown>>,
    requestedByActorId: input.requestedBy.id,
    requestedByActorType: input.requestedBy.actorType,
    status: "pending",
  };
  await deps.approvals.create(request);
  return request;
}
