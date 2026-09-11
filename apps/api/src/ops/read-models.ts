import type { ActorRecord, ApprovalRequestRecord, CustodianFileRecord, InboundEventRecord, ReconBreakRecord, ReconRunRecord } from "@corgi/application";
import type {
  ApprovalResponse,
  InboundEventResponse,
  OpsOverviewResponse,
  ReconRunResponse,
  ReconciliationBreakResponse,
  ReconciliationResponse,
} from "@corgi/contracts";
import { type AgingBucket, ageInDays, agingBucket, businessDate } from "@corgi/domain";
import type { CustomerServices } from "../customer/services.js";

const str = (value: bigint): string => value.toString();
const iso = (value: Date): string => value.toISOString();

/** Resolves actors once per response instead of once per row. */
class ActorLookup {
  private readonly cache = new Map<string, ActorRecord | null>();
  constructor(private readonly services: CustomerServices) {}

  async summary(id: string): Promise<ApprovalResponse["requestedBy"]> {
    if (!this.cache.has(id)) this.cache.set(id, await this.services.actors.findById(id));
    const actor = this.cache.get(id) ?? null;
    return { id, displayName: actor?.displayName ?? "Unknown actor", actorType: actor?.actorType ?? "human" };
  }
}

/* ------------------------------------------------------------------ */
/* Approvals                                                            */
/* ------------------------------------------------------------------ */

export async function toApprovalResponse(services: CustomerServices, request: ApprovalRequestRecord, actors = new ActorLookup(services)): Promise<ApprovalResponse> {
  const decision = request.status === "pending" ? null : await services.approvals.decisionFor(request.id);
  return {
    id: request.id,
    kind: request.kind,
    amountCents: str(request.amountCents),
    payload: request.payload,
    requestedBy: await actors.summary(request.requestedByActorId),
    status: request.status,
    createdAt: iso(request.createdAt),
    decision: decision
      ? { decidedBy: await actors.summary(decision.decidedByActorId), decision: decision.decision, reason: decision.reason, decidedAt: iso(decision.decidedAt) }
      : null,
  };
}

export async function loadApprovals(services: CustomerServices, status?: ApprovalRequestRecord["status"]): Promise<ApprovalResponse[]> {
  const actors = new ActorLookup(services);
  const rows = await services.approvals.list(status ? { status } : {});
  return Promise.all(rows.map((row) => toApprovalResponse(services, row, actors)));
}

/* ------------------------------------------------------------------ */
/* Reconciliation                                                       */
/* ------------------------------------------------------------------ */

function toRunResponse(run: ReconRunRecord, file: CustodianFileRecord | null): ReconRunResponse {
  return {
    id: run.id,
    businessDate: run.businessDate,
    fileId: run.fileId,
    fileBusinessDate: file?.businessDate ?? null,
    fileSource: file?.source ?? null,
    status: run.status,
    startedAt: iso(run.startedAt),
    finishedAt: run.finishedAt ? iso(run.finishedAt) : null,
  };
}

async function toBreakResponse(services: CustomerServices, brk: ReconBreakRecord, today: string, actors: ActorLookup): Promise<ReconciliationBreakResponse> {
  const days = ageInDays(brk.firstSeenBusinessDate, today);
  return {
    id: brk.id,
    customerId: brk.customerId,
    category: brk.category,
    key: brk.key,
    ledgerValue: str(brk.ledgerValue),
    custodianValue: str(brk.custodianValue),
    brokerValue: brk.brokerValue === null ? null : str(brk.brokerValue),
    delta: str(brk.delta),
    firstSeenBusinessDate: brk.firstSeenBusinessDate,
    ageDays: days,
    agingBucket: agingBucket(days),
    status: brk.status,
    resolutionNote: brk.resolutionNote,
    resolutionEntryId: brk.resolutionEntryId,
    resolvedBy: brk.resolvedByActorId ? await actors.summary(brk.resolvedByActorId) : null,
    resolvedAt: brk.resolvedAt ? iso(brk.resolvedAt) : null,
  };
}

export async function loadReconciliation(services: CustomerServices): Promise<ReconciliationResponse> {
  const today = businessDate(services.clock.now());
  const actors = new ActorLookup(services);
  const [runs, breaks] = await Promise.all([services.reconciliation.listRuns(20), services.reconciliation.listBreaks({ limit: 200 })]);
  const files = new Map<string, CustodianFileRecord | null>();
  for (const run of runs) {
    if (!files.has(run.fileId)) files.set(run.fileId, await services.custodianFiles.findById(run.fileId));
  }
  const runResponses = runs.map((run) => toRunResponse(run, files.get(run.fileId) ?? null));
  const breakResponses = await Promise.all(breaks.map((brk) => toBreakResponse(services, brk, today, actors)));

  const openByBucket: Record<AgingBucket, number> = { "0-1d": 0, "2-3d": 0, "4d+": 0 };
  for (const brk of breakResponses) if (brk.status === "open") openByBucket[brk.agingBucket] += 1;

  return {
    today,
    latestRun: runResponses[0] ?? null,
    runs: runResponses,
    // Open first (oldest first), then the closed trail newest first.
    breaks: [...breakResponses].sort((a, b) => {
      if ((a.status === "open") !== (b.status === "open")) return a.status === "open" ? -1 : 1;
      return a.status === "open" ? b.ageDays - a.ageDays : (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? "");
    }),
    openByBucket,
  };
}

/* ------------------------------------------------------------------ */
/* Events                                                               */
/* ------------------------------------------------------------------ */

export function toEventResponse(event: InboundEventRecord): InboundEventResponse {
  const last = event.attempts.at(-1);
  return {
    id: event.id,
    provider: event.provider,
    externalId: event.externalId,
    dedupeKey: event.dedupeKey,
    type: event.type,
    signatureValid: event.signatureValid,
    receivedAt: iso(event.receivedAt),
    outcome: last ? last.status : "pending",
    attempts: event.attempts.map((attempt) => ({ status: attempt.status, error: attempt.error, at: iso(attempt.at) })),
  };
}

/* ------------------------------------------------------------------ */
/* Overview                                                             */
/* ------------------------------------------------------------------ */

export async function loadOverview(services: CustomerServices): Promise<OpsOverviewResponse> {
  const now = services.clock.now();
  const today = businessDate(now);
  const [pending, openBreaks, runs, events, settlements] = await Promise.all([
    services.approvals.list({ status: "pending" }),
    services.reconciliation.listBreaks({ status: "open" }),
    services.reconciliation.listRuns(1),
    services.events.list(200),
    services.settlements.listPending(),
  ]);
  const latestRun = runs[0] ?? null;
  const latestFile = latestRun ? await services.custodianFiles.findById(latestRun.fileId) : null;
  const ages = openBreaks.map((brk) => ageInDays(brk.firstSeenBusinessDate, today));

  const blocked: OpsOverviewResponse["blockedCustomers"] = [];
  for (const customerId of new Set(pending.filter((r) => r.payload.intent === "sell_to_cover").map((r) => String(r.payload.customerId)))) {
    const profile = await services.directory.findProfile(customerId);
    if (profile?.tradingBlocked) blocked.push({ customerId, displayName: profile.displayName });
  }

  return {
    now: iso(now),
    pendingApprovals: pending.length,
    openBreaks: openBreaks.length,
    oldestOpenBreakDays: ages.length === 0 ? null : Math.max(...ages),
    latestRun: latestRun ? toRunResponse(latestRun, latestFile) : null,
    eventsToday: events.filter((event) => businessDate(event.receivedAt) === today).length,
    failedEvents: events.filter((event) => event.attempts.at(-1)?.status === "failed").length,
    pendingSettlements: settlements.length,
    providers: [
      { name: "Alpaca broker", configured: services.broker !== null },
      { name: "Alpaca market data", configured: services.marketData !== null },
      { name: "Plaid", configured: services.funding !== null },
      { name: "Persona", configured: services.identity !== null },
    ],
    blockedCustomers: blocked,
  };
}
