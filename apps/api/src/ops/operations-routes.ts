import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  type ActorRecord,
  buildApprovalExecutors,
  decideApproval,
  explainBreak,
  generateCustodianFile,
  proposeRebalanceForCustomer,
  releaseTradingBlock,
  requestBreakAdjustment,
  requestWithdrawal,
  runReconciliation,
  settleDueTrades,
} from "@corgi/application";
import {
  type ApprovalResponse,
  type ApprovalsResponse,
  type DecideApprovalResponse,
  type FiledApprovalResponse,
  type InboundEventsResponse,
  type LiveFireResponse,
  type OperatorsResponse,
  type OpsOverviewResponse,
  type ReconciliationResponse,
  type ReleaseTradingBlockResponse,
  type ReplayEventResponse,
  adjustBreakRequest,
  approvalStatus,
  decideApprovalRequest,
  explainBreakRequest,
  generateCustodianFileRequest,
  proposeRebalanceRequest,
  requestWithdrawalRequest,
  runReconciliationRequest,
} from "@corgi/contracts";
import { type CustodianTamper, businessDate } from "@corgi/domain";
import type { CustomerServices } from "../customer/services.js";
import { HttpError, parseBody } from "../http.js";
import { loadApprovals, loadOverview, loadReconciliation, toApprovalResponse, toEventResponse } from "./read-models.js";

export const OPERATOR_HEADER = "x-operator-id";

/**
 * Who is acting. The shared operator token says "an operator"; this header says
 * which one, and it must name a human actor. Maker ≠ checker is then enforced
 * by the domain and again by the database trigger (ADR-0005).
 */
async function requireOperator(services: CustomerServices, request: FastifyRequest): Promise<ActorRecord> {
  const header = request.headers[OPERATOR_HEADER];
  const id = Array.isArray(header) ? header[0] : header;
  if (!id) throw new HttpError(400, "operator_required", `Send the acting operator in the ${OPERATOR_HEADER} header`);
  const actor = await services.actors.findById(id);
  if (!actor) throw new HttpError(404, "operator_unknown", "No such operator");
  if (actor.actorType !== "human") throw new HttpError(403, "operator_not_human", "Only human operators may act here");
  return actor;
}

const params = (request: FastifyRequest): { id: string } => request.params as { id: string };

function toTamper(tamper: NonNullable<ReturnType<typeof generateCustodianFileRequest.parse>["tamper"]>): CustodianTamper {
  switch (tamper.kind) {
    case "position":
      return { kind: "position", customerId: tamper.customerId, symbol: tamper.symbol, deltaUnitsMicro: BigInt(tamper.deltaUnitsMicro) };
    case "cash":
      return { kind: "cash", customerId: tamper.customerId, deltaCents: BigInt(tamper.deltaCents) };
    case "drop_transaction":
      return { kind: "drop_transaction", customerId: tamper.customerId, entryId: tamper.entryId };
  }
}

/** Approvals, reconciliation, events and the overview — registered inside the ops auth scope. */
export function registerOperationsRoutes(app: FastifyInstance, services: CustomerServices): void {
  const executors = buildApprovalExecutors({ ...services, confirmationThresholdCents: services.limits.orderConfirmationThresholdCents });

  app.get("/ops/operators", async (): Promise<OperatorsResponse> => {
    const humans = await services.actors.listHumans();
    return { operators: humans.map((actor) => ({ id: actor.id, displayName: actor.displayName, role: actor.role })) };
  });

  app.get("/ops/overview", (): Promise<OpsOverviewResponse> => loadOverview(services));

  /* ---------------------------- approvals ---------------------------- */

  app.get("/ops/approvals", async (request): Promise<ApprovalsResponse> => {
    const query = request.query as { status?: string };
    const status = query.status ? approvalStatus.parse(query.status) : undefined;
    return { rows: await loadApprovals(services, status) };
  });

  app.post("/ops/approvals/:id/decide", async (request): Promise<DecideApprovalResponse> => {
    const operator = await requireOperator(services, request);
    const body = parseBody(decideApprovalRequest, request.body);
    const result = await decideApproval({ ...services, executors }, { requestId: params(request).id, actorId: operator.id, decision: body.decision, reason: body.reason });
    return { request: await toApprovalResponse(services, result.request), outcome: result.outcome };
  });

  app.post("/ops/approvals/propose-rebalance", async (request): Promise<FiledApprovalResponse> => {
    const operator = await requireOperator(services, request);
    const body = parseBody(proposeRebalanceRequest, request.body);
    const result = await proposeRebalanceForCustomer(services, { customerId: body.customerId, reason: body.reason, requestedBy: operator });
    return result.status === "filed"
      ? { status: "filed", approvalId: result.request.id, legs: result.legs.map((leg) => ({ symbol: leg.symbol, side: leg.side, notionalCents: leg.notionalCents.toString() })) }
      : { status: "in_balance", approvalId: null, legs: [] };
  });

  app.post("/ops/approvals/request-withdrawal", async (request): Promise<FiledApprovalResponse> => {
    const operator = await requireOperator(services, request);
    const body = parseBody(requestWithdrawalRequest, request.body);
    const filed = await requestWithdrawal(services, { customerId: body.customerId, amountCents: BigInt(body.amountCents), reason: body.reason, requestedBy: operator });
    return { status: "filed", approvalId: filed.id, legs: [] };
  });

  /* -------------------------- reconciliation ------------------------- */

  app.get("/ops/reconciliation", (): Promise<ReconciliationResponse> => loadReconciliation(services));

  app.post("/ops/custodian-file", async (request): Promise<LiveFireResponse> => {
    const body = parseBody(generateCustodianFileRequest, request.body);
    const result = await generateCustodianFile(services, { businessDate: body.businessDate, ...(body.tamper ? { tamper: toTamper(body.tamper) } : {}) });
    return {
      action: "custodian_file",
      summary: { businessDate: body.businessDate, fileId: result.file.id, sha256: result.file.sha256, rows: result.rows, source: result.file.source, tampered: result.tampered },
      restatements: [],
    };
  });

  app.post("/ops/reconciliation/run", async (request): Promise<LiveFireResponse> => {
    const body = parseBody(runReconciliationRequest, request.body);
    const result = await runReconciliation(services, { businessDate: body.businessDate });
    if (result.status === "no_file") {
      return { action: "reconcile", summary: { businessDate: body.businessDate, status: "no_file", message: "No custodian file on or before this date" }, restatements: [] };
    }
    return {
      action: "reconcile",
      summary: {
        businessDate: body.businessDate,
        status: "completed",
        runId: result.run.id,
        fileBusinessDate: result.file.businessDate,
        fileIsStale: result.fileIsStale,
        breaks: result.breaks.length,
        opened: result.opened,
        refreshed: result.refreshed,
        customersMatched: result.matched.customers,
        positionsMatched: result.matched.positions,
        transactionsMatched: result.matched.transactions,
      },
      restatements: [],
    };
  });

  app.post("/ops/reconciliation/breaks/:id/explain", async (request) => {
    const operator = await requireOperator(services, request);
    const body = parseBody(explainBreakRequest, request.body);
    const brk = await explainBreak(services, { breakId: params(request).id, actorId: operator.id, note: body.note });
    return { id: brk.id, status: brk.status };
  });

  app.post("/ops/reconciliation/breaks/:id/adjust", async (request): Promise<ApprovalResponse> => {
    const operator = await requireOperator(services, request);
    const body = parseBody(adjustBreakRequest, request.body);
    const filed = await requestBreakAdjustment(services, { breakId: params(request).id, requestedBy: operator, note: body.note });
    const stored = await services.approvals.findById(filed.id);
    if (!stored) throw new HttpError(500, "internal_error", "Approval was not stored");
    return toApprovalResponse(services, stored);
  });

  /* ------------------------------ events ----------------------------- */

  app.get("/ops/events", async (request): Promise<InboundEventsResponse> => {
    const query = request.query as { limit?: string };
    const limit = Math.min(500, Math.max(1, Number(query.limit ?? 100) || 100));
    return { rows: (await services.events.list(limit)).map(toEventResponse) };
  });

  // "Twice is one": the stored event goes back through the same ingress the
  // webhooks use and the inbox answers `duplicate`.
  app.post("/ops/events/:id/replay", async (request): Promise<ReplayEventResponse> => {
    const event = await services.events.findById(params(request).id);
    if (!event) throw new HttpError(404, "not_found", "Event not found");
    const receive = await services.inbox.receive({
      provider: event.provider,
      externalId: event.externalId,
      dedupeKey: event.dedupeKey,
      type: event.type,
      payload: event.payload,
      signatureValid: event.signatureValid,
      receivedAt: services.clock.now(),
    });
    return { eventId: event.id, dedupeKey: event.dedupeKey, receive };
  });

  /* ---------------------------- settlement --------------------------- */

  app.post("/ops/live-fire/settle-trades", async (): Promise<LiveFireResponse> => {
    const today = businessDate(services.clock.now());
    const result = await settleDueTrades(services, today);
    return {
      action: "settle_trades",
      summary: { today, settled: result.settled.length, alreadySettled: result.alreadySettled, stillPending: (await services.settlements.listPending()).length },
      restatements: [],
    };
  });

  /* ------------------------ bounce close-out ------------------------- */

  app.post("/ops/customers/:id/release-trading-block", async (request): Promise<ReleaseTradingBlockResponse> => {
    const operator = await requireOperator(services, request);
    const result = await releaseTradingBlock(services, { customerId: params(request).id, actorId: operator.id });
    return { customerId: result.customerId, recoveredCents: result.recoveredCents.toString(), tradingBlocked: result.tradingBlocked };
  });
}
