/**
 * In-memory implementations of the operations ports (approvals, actors,
 * settlement, custodian files, reconciliation). They mirror the database
 * invariants that matter to use-cases — maker ≠ checker, one open break per
 * identity, idempotent settlement rows — so use-case and route tests exercise
 * real semantics without Postgres. Imported only via `@corgi/application/testing`.
 */
import { randomUUID } from "node:crypto";
import type { ApprovalRequest, ApprovalStatus } from "@corgi/domain";
import type {
  ActorDirectory,
  ActorRecord,
  ApprovalDecisionRecord,
  ApprovalRepository,
  ApprovalRequestRecord,
  CustodianFileRecord,
  CustodianFileRepository,
  ReconBreakRecord,
  ReconBreakStatus,
  ReconRunRecord,
  ReconSighting,
  ReconciliationRepository,
  SettlementRecord,
  SettlementRepository,
} from "../ports.js";

export class FakeApprovalRepository implements ApprovalRepository {
  readonly requests: ApprovalRequestRecord[] = [];
  readonly decisions: ApprovalDecisionRecord[] = [];
  private readonly createdAt = new Date("2026-09-11T08:00:00Z");

  create(request: ApprovalRequest): Promise<void> {
    this.requests.push({ ...request, createdAt: this.createdAt });
    return Promise.resolve();
  }

  findById(id: string): Promise<ApprovalRequestRecord | null> {
    return Promise.resolve(this.requests.find((request) => request.id === id) ?? null);
  }

  list(filter: { status?: ApprovalStatus; limit?: number }): Promise<readonly ApprovalRequestRecord[]> {
    const rows = this.requests.filter((request) => !filter.status || request.status === filter.status);
    return Promise.resolve(rows.slice(0, filter.limit ?? rows.length));
  }

  recordDecision(decision: ApprovalDecisionRecord): Promise<void> {
    // Mirrors the database trigger so a bypassed domain check still fails here.
    const index = this.requests.findIndex((request) => request.id === decision.requestId);
    const request = this.requests[index];
    if (!request) throw new Error("unknown request");
    if (request.requestedByActorId === decision.decidedByActorId) throw new Error("initiator cannot decide their own approval request");
    if (decision.decidedByActorType !== "human") throw new Error("autonomous agents cannot decide approval requests");
    this.decisions.push(decision);
    this.requests[index] = { ...request, status: decision.decision };
    return Promise.resolve();
  }

  decisionFor(requestId: string): Promise<ApprovalDecisionRecord | null> {
    return Promise.resolve(this.decisions.find((decision) => decision.requestId === requestId) ?? null);
  }
}

export class FakeActorDirectory implements ActorDirectory {
  constructor(private readonly actors: readonly ActorRecord[]) {}

  findById(id: string): Promise<ActorRecord | null> {
    return Promise.resolve(this.actors.find((actor) => actor.id === id) ?? null);
  }

  listHumans(): Promise<readonly ActorRecord[]> {
    return Promise.resolve(this.actors.filter((actor) => actor.actorType === "human"));
  }

  findByRole(role: string): Promise<ActorRecord | null> {
    return Promise.resolve(this.actors.find((actor) => actor.role === role) ?? null);
  }
}

export class FakeSettlementRepository implements SettlementRepository {
  readonly rows: SettlementRecord[] = [];

  record(settlement: SettlementRecord): Promise<void> {
    if (!this.rows.some((row) => row.fillExternalId === settlement.fillExternalId)) this.rows.push(settlement);
    return Promise.resolve();
  }

  listDue(onOrBefore: string): Promise<readonly SettlementRecord[]> {
    return Promise.resolve(this.rows.filter((row) => row.status === "pending" && row.contractualSettlementDate <= onOrBefore));
  }

  listPending(): Promise<readonly SettlementRecord[]> {
    return Promise.resolve(this.rows.filter((row) => row.status === "pending"));
  }

  markSettled(id: string, journalEntryId: string): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === id);
    const row = this.rows[index];
    if (row) this.rows[index] = { ...row, status: "settled", journalEntryId };
    return Promise.resolve();
  }
}

export class FakeCustodianFileRepository implements CustodianFileRepository {
  readonly files: CustodianFileRecord[] = [];

  save(file: CustodianFileRecord): Promise<void> {
    this.files.push(file);
    return Promise.resolve();
  }

  findById(id: string): Promise<CustodianFileRecord | null> {
    return Promise.resolve(this.files.find((file) => file.id === id) ?? null);
  }

  latestOnOrBefore(businessDate: string): Promise<CustodianFileRecord | null> {
    // Latest business date wins; among equals the most recently saved (insertion order).
    const candidates = this.files.filter((file) => file.businessDate <= businessDate);
    const newest = candidates.reduce<CustodianFileRecord | null>((best, file) => (!best || file.businessDate >= best.businessDate ? file : best), null);
    return Promise.resolve(newest);
  }
}

export class FakeReconciliationRepository implements ReconciliationRepository {
  readonly runs: ReconRunRecord[] = [];
  readonly breaks: ReconBreakRecord[] = [];

  createRun(run: ReconRunRecord): Promise<void> {
    this.runs.push(run);
    return Promise.resolve();
  }

  finishRun(id: string, status: "completed" | "failed", finishedAt: Date): Promise<void> {
    const index = this.runs.findIndex((run) => run.id === id);
    const run = this.runs[index];
    if (run) this.runs[index] = { ...run, status, finishedAt };
    return Promise.resolve();
  }

  listRuns(limit: number): Promise<readonly ReconRunRecord[]> {
    return Promise.resolve([...this.runs].reverse().slice(0, limit));
  }

  recordSightings(run: ReconRunRecord, sightings: readonly ReconSighting[]): Promise<{ opened: number; refreshed: number }> {
    let opened = 0;
    let refreshed = 0;
    for (const sighting of sightings) {
      const index = this.breaks.findIndex(
        (b) => b.status === "open" && b.customerId === sighting.customerId && b.category === sighting.category && b.key === sighting.key,
      );
      const existing = this.breaks[index];
      if (existing) {
        this.breaks[index] = { ...existing, ...sighting, lastSeenRunId: run.id };
        refreshed += 1;
      } else {
        this.breaks.push({
          ...sighting,
          id: randomUUID(),
          firstRunId: run.id,
          lastSeenRunId: run.id,
          firstSeenBusinessDate: run.businessDate,
          status: "open",
          resolutionEntryId: null,
          resolutionNote: null,
          resolvedByActorId: null,
          resolvedAt: null,
          createdAt: run.startedAt,
        });
        opened += 1;
      }
    }
    return Promise.resolve({ opened, refreshed });
  }

  listBreaks(filter: { status?: ReconBreakStatus; limit?: number }): Promise<readonly ReconBreakRecord[]> {
    const rows = this.breaks.filter((b) => !filter.status || b.status === filter.status);
    return Promise.resolve(rows.slice(0, filter.limit ?? rows.length));
  }

  findBreak(id: string): Promise<ReconBreakRecord | null> {
    return Promise.resolve(this.breaks.find((b) => b.id === id) ?? null);
  }

  closeBreak(input: { id: string; status: "explained" | "resolved"; note: string; actorId: string; entryId: string | null; at: Date }): Promise<void> {
    const index = this.breaks.findIndex((b) => b.id === input.id);
    const existing = this.breaks[index];
    if (existing) {
      this.breaks[index] = {
        ...existing,
        status: input.status,
        resolutionNote: input.note,
        resolvedByActorId: input.actorId,
        resolutionEntryId: input.entryId,
        resolvedAt: input.at,
      };
    }
    return Promise.resolve();
  }
}
