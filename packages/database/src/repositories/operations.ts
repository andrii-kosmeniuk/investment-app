import type {
  ActorDirectory,
  ActorRecord,
  ApprovalDecisionRecord,
  ApprovalRepository,
  ApprovalRequestRecord,
  CustodianFileRecord,
  CustodianFileRepository,
  InboundEventLog,
  InboundEventRecord,
  ReconBreakRecord,
  ReconBreakStatus,
  ReconRunRecord,
  ReconSighting,
  ReconciliationRepository,
  SettlementRecord,
  SettlementRepository,
} from "@corgi/application";
import type { ApprovalRequest, ApprovalStatus, ReconCategory } from "@corgi/domain";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import type { TransactionalDatabase } from "../pool.js";
import {
  actors,
  approvalDecisions,
  approvalRequests,
  custodianFiles,
  inboundEventAttempts,
  inboundEvents,
  reconBreaks,
  reconRuns,
  settlements,
} from "../schema.js";

/* ------------------------------------------------------------------ */
/* Actors                                                               */
/* ------------------------------------------------------------------ */

const toActor = (row: typeof actors.$inferSelect): ActorRecord => ({
  id: row.id,
  displayName: row.displayName,
  actorType: row.actorType,
  role: row.role,
});

export class DrizzleActorDirectory implements ActorDirectory {
  constructor(private readonly db: TransactionalDatabase) {}

  async findById(id: string): Promise<ActorRecord | null> {
    const [row] = await this.db.select().from(actors).where(eq(actors.id, id)).limit(1);
    return row ? toActor(row) : null;
  }

  async listHumans(): Promise<readonly ActorRecord[]> {
    const rows = await this.db.select().from(actors).where(eq(actors.actorType, "human")).orderBy(actors.displayName);
    return rows.map(toActor);
  }

  async findByRole(role: string): Promise<ActorRecord | null> {
    const [row] = await this.db.select().from(actors).where(eq(actors.role, role)).limit(1);
    return row ? toActor(row) : null;
  }
}

/* ------------------------------------------------------------------ */
/* Approvals                                                            */
/* ------------------------------------------------------------------ */

const toRequest = (row: typeof approvalRequests.$inferSelect): ApprovalRequestRecord => ({
  id: row.id,
  kind: row.kind as ApprovalRequest["kind"],
  amountCents: row.amountCents,
  payload: (row.payload ?? {}) as Readonly<Record<string, unknown>>,
  requestedByActorId: row.requestedByActorId,
  requestedByActorType: row.requestedByActorType,
  status: row.status,
  createdAt: row.createdAt,
});

/**
 * The maker-checker queue. `recordDecision` runs in one transaction: the
 * decision row (guarded by the `approval_maker_checker` trigger and the
 * human-only CHECK) and the status change either both land or neither does.
 */
export class DrizzleApprovalRepository implements ApprovalRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async create(request: ApprovalRequest): Promise<void> {
    await this.db.insert(approvalRequests).values({
      id: request.id,
      kind: request.kind,
      amountCents: request.amountCents,
      payload: request.payload,
      requestedByActorId: request.requestedByActorId,
      requestedByActorType: request.requestedByActorType,
      status: request.status,
    });
  }

  async findById(id: string): Promise<ApprovalRequestRecord | null> {
    const [row] = await this.db.select().from(approvalRequests).where(eq(approvalRequests.id, id)).limit(1);
    return row ? toRequest(row) : null;
  }

  async list(filter: { status?: ApprovalStatus; limit?: number }): Promise<readonly ApprovalRequestRecord[]> {
    const rows = await this.db
      .select()
      .from(approvalRequests)
      .where(filter.status ? eq(approvalRequests.status, filter.status) : undefined)
      .orderBy(desc(approvalRequests.createdAt))
      .limit(filter.limit ?? 200);
    return rows.map(toRequest);
  }

  async recordDecision(decision: ApprovalDecisionRecord): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(approvalDecisions).values({
        id: decision.id,
        requestId: decision.requestId,
        decidedByActorId: decision.decidedByActorId,
        decidedByActorType: decision.decidedByActorType,
        decision: decision.decision,
        reason: decision.reason,
        decidedAt: decision.decidedAt,
      });
      await tx
        .update(approvalRequests)
        .set({ status: decision.decision })
        .where(and(eq(approvalRequests.id, decision.requestId), eq(approvalRequests.status, "pending")));
    });
  }

  async decisionFor(requestId: string): Promise<ApprovalDecisionRecord | null> {
    const [row] = await this.db.select().from(approvalDecisions).where(eq(approvalDecisions.requestId, requestId)).limit(1);
    if (!row) return null;
    return {
      id: row.id,
      requestId: row.requestId,
      decidedByActorId: row.decidedByActorId,
      decidedByActorType: row.decidedByActorType,
      decision: row.decision as ApprovalDecisionRecord["decision"],
      reason: row.reason,
      decidedAt: row.decidedAt,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Settlements                                                          */
/* ------------------------------------------------------------------ */

const toSettlement = (row: typeof settlements.$inferSelect): SettlementRecord => ({
  id: row.id,
  orderId: row.orderId,
  fillExternalId: row.fillExternalId,
  side: row.side as "buy" | "sell",
  amountCents: row.amountCents,
  tradeDate: row.tradeDate,
  contractualSettlementDate: row.contractualSettlementDate,
  status: row.status as SettlementRecord["status"],
  journalEntryId: row.journalEntryId,
});

export class DrizzleSettlementRepository implements SettlementRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async record(settlement: SettlementRecord): Promise<void> {
    await this.db
      .insert(settlements)
      .values({
        id: settlement.id,
        orderId: settlement.orderId,
        fillExternalId: settlement.fillExternalId,
        side: settlement.side,
        amountCents: settlement.amountCents,
        tradeDate: settlement.tradeDate,
        contractualSettlementDate: settlement.contractualSettlementDate,
        status: settlement.status,
        journalEntryId: settlement.journalEntryId,
      })
      .onConflictDoNothing({ target: settlements.fillExternalId });
  }

  async listDue(onOrBefore: string): Promise<readonly SettlementRecord[]> {
    const rows = await this.db
      .select()
      .from(settlements)
      .where(and(eq(settlements.status, "pending"), lte(settlements.contractualSettlementDate, onOrBefore)))
      .orderBy(settlements.contractualSettlementDate);
    return rows.map(toSettlement);
  }

  async listPending(): Promise<readonly SettlementRecord[]> {
    const rows = await this.db.select().from(settlements).where(eq(settlements.status, "pending")).orderBy(settlements.contractualSettlementDate);
    return rows.map(toSettlement);
  }

  async markSettled(id: string, journalEntryId: string): Promise<void> {
    await this.db.update(settlements).set({ status: "settled", journalEntryId }).where(eq(settlements.id, id));
  }
}

/* ------------------------------------------------------------------ */
/* Custodian files                                                      */
/* ------------------------------------------------------------------ */

const toFile = (row: typeof custodianFiles.$inferSelect): CustodianFileRecord => ({
  id: row.id,
  businessDate: row.businessDate,
  kind: "combined",
  sha256: row.sha256,
  storagePath: row.storagePath,
  content: row.content,
  source: row.source,
  receivedAt: row.receivedAt,
});

export class DrizzleCustodianFileRepository implements CustodianFileRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async save(file: CustodianFileRecord): Promise<void> {
    await this.db.insert(custodianFiles).values({
      id: file.id,
      businessDate: file.businessDate,
      kind: file.kind,
      sha256: file.sha256,
      storagePath: file.storagePath,
      content: file.content,
      source: file.source,
      receivedAt: file.receivedAt,
    });
  }

  async findById(id: string): Promise<CustodianFileRecord | null> {
    const [row] = await this.db.select().from(custodianFiles).where(eq(custodianFiles.id, id)).limit(1);
    return row ? toFile(row) : null;
  }

  async latestOnOrBefore(businessDate: string): Promise<CustodianFileRecord | null> {
    const [row] = await this.db
      .select()
      .from(custodianFiles)
      .where(lte(custodianFiles.businessDate, businessDate))
      .orderBy(desc(custodianFiles.businessDate), desc(custodianFiles.receivedAt))
      .limit(1);
    return row ? toFile(row) : null;
  }
}

/* ------------------------------------------------------------------ */
/* Reconciliation runs and breaks                                       */
/* ------------------------------------------------------------------ */

const toRun = (row: typeof reconRuns.$inferSelect): ReconRunRecord => ({
  id: row.id,
  businessDate: row.businessDate,
  fileId: row.fileId,
  status: row.status as ReconRunRecord["status"],
  ledgerSnapshotHash: row.ledgerSnapshotHash,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
});

type BreakRow = typeof reconBreaks.$inferSelect;

const toBreak = (row: BreakRow, firstSeenBusinessDate: string): ReconBreakRecord => ({
  id: row.id,
  firstRunId: row.firstRunId,
  lastSeenRunId: row.lastSeenRunId,
  firstSeenBusinessDate,
  customerId: row.customerId,
  category: row.category as ReconCategory,
  key: row.key,
  ledgerValue: BigInt(row.ledgerValue),
  custodianValue: BigInt(row.custodianValue),
  delta: BigInt(row.delta),
  brokerValue: row.brokerValue === null ? null : BigInt(row.brokerValue),
  status: row.status as ReconBreakStatus,
  resolutionEntryId: row.resolutionEntryId,
  resolutionNote: row.resolutionNote,
  resolvedByActorId: row.resolvedByActorId,
  resolvedAt: row.resolvedAt,
  createdAt: row.createdAt,
});

export class DrizzleReconciliationRepository implements ReconciliationRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async createRun(run: ReconRunRecord): Promise<void> {
    await this.db.insert(reconRuns).values({
      id: run.id,
      businessDate: run.businessDate,
      fileId: run.fileId,
      status: run.status,
      ledgerSnapshotHash: run.ledgerSnapshotHash,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    });
  }

  async finishRun(id: string, status: "completed" | "failed", finishedAt: Date): Promise<void> {
    await this.db.update(reconRuns).set({ status, finishedAt }).where(eq(reconRuns.id, id));
  }

  async listRuns(limit: number): Promise<readonly ReconRunRecord[]> {
    const rows = await this.db.select().from(reconRuns).orderBy(desc(reconRuns.startedAt)).limit(limit);
    return rows.map(toRun);
  }

  async recordSightings(run: ReconRunRecord, sightings: readonly ReconSighting[]): Promise<{ opened: number; refreshed: number }> {
    let opened = 0;
    let refreshed = 0;
    for (const sighting of sightings) {
      const values = {
        ledgerValue: sighting.ledgerValue.toString(),
        custodianValue: sighting.custodianValue.toString(),
        delta: sighting.delta.toString(),
        brokerValue: sighting.brokerValue === null ? null : sighting.brokerValue.toString(),
      };
      const updated = await this.db
        .update(reconBreaks)
        .set({ ...values, lastSeenRunId: run.id })
        .where(
          and(
            eq(reconBreaks.status, "open"),
            eq(reconBreaks.customerId, sighting.customerId),
            eq(reconBreaks.category, sighting.category),
            eq(reconBreaks.key, sighting.key),
          ),
        )
        .returning({ id: reconBreaks.id });
      if (updated.length > 0) {
        refreshed += 1;
        continue;
      }
      await this.db.insert(reconBreaks).values({
        firstRunId: run.id,
        lastSeenRunId: run.id,
        customerId: sighting.customerId,
        category: sighting.category,
        key: sighting.key,
        ...values,
        status: "open",
      });
      opened += 1;
    }
    return { opened, refreshed };
  }

  async listBreaks(filter: { status?: ReconBreakStatus; limit?: number }): Promise<readonly ReconBreakRecord[]> {
    const rows = await this.db
      .select({ brk: reconBreaks, firstSeen: reconRuns.businessDate })
      .from(reconBreaks)
      .innerJoin(reconRuns, eq(reconRuns.id, reconBreaks.firstRunId))
      .where(filter.status ? eq(reconBreaks.status, filter.status) : undefined)
      .orderBy(reconBreaks.createdAt)
      .limit(filter.limit ?? 500);
    return rows.map((row) => toBreak(row.brk, row.firstSeen));
  }

  async findBreak(id: string): Promise<ReconBreakRecord | null> {
    const [row] = await this.db
      .select({ brk: reconBreaks, firstSeen: reconRuns.businessDate })
      .from(reconBreaks)
      .innerJoin(reconRuns, eq(reconRuns.id, reconBreaks.firstRunId))
      .where(eq(reconBreaks.id, id))
      .limit(1);
    return row ? toBreak(row.brk, row.firstSeen) : null;
  }

  async closeBreak(input: { id: string; status: "explained" | "resolved"; note: string; actorId: string; entryId: string | null; at: Date }): Promise<void> {
    await this.db
      .update(reconBreaks)
      .set({
        status: input.status,
        resolutionNote: input.note,
        resolvedByActorId: input.actorId,
        resolutionEntryId: input.entryId,
        resolvedAt: input.at,
      })
      .where(and(eq(reconBreaks.id, input.id), eq(reconBreaks.status, "open")));
  }
}

/* ------------------------------------------------------------------ */
/* Inbound event log (operator view)                                    */
/* ------------------------------------------------------------------ */

export class DrizzleInboundEventLog implements InboundEventLog {
  constructor(private readonly db: TransactionalDatabase) {}

  async list(limit: number): Promise<readonly InboundEventRecord[]> {
    const rows = await this.db.select().from(inboundEvents).orderBy(desc(inboundEvents.receivedAt)).limit(limit);
    return this.withAttempts(rows);
  }

  async findById(id: string): Promise<InboundEventRecord | null> {
    const rows = await this.db.select().from(inboundEvents).where(eq(inboundEvents.id, id)).limit(1);
    const [record] = await this.withAttempts(rows);
    return record ?? null;
  }

  private async withAttempts(rows: readonly (typeof inboundEvents.$inferSelect)[]): Promise<readonly InboundEventRecord[]> {
    if (rows.length === 0) return [];
    const attempts = await this.db
      .select()
      .from(inboundEventAttempts)
      .where(inArray(inboundEventAttempts.eventId, rows.map((row) => row.id)))
      .orderBy(inboundEventAttempts.startedAt);
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      externalId: row.externalId,
      dedupeKey: row.dedupeKey,
      type: row.eventType,
      payload: row.payload,
      signatureValid: row.signatureValid,
      receivedAt: row.receivedAt,
      attempts: attempts
        .filter((attempt) => attempt.eventId === row.id)
        .map((attempt) => ({ status: attempt.status as "processed" | "failed", error: attempt.error, at: attempt.finishedAt ?? attempt.startedAt })),
    }));
  }
}
