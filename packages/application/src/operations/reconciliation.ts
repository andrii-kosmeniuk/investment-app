import { createHash } from "node:crypto";
import {
  type CustodianRow,
  type CustodianTamper,
  type ReconBreak,
  buildCustodianFile,
  businessDate,
  endOfBusinessDay,
  parseCustodianFile,
  postingPatterns,
  reconcileRows,
  tamperCustodianRows,
} from "@corgi/domain";
import { NotFoundError, ValidationError } from "../errors.js";
import { deriveCustomerBalances } from "../ledger/balances.js";
import { type PostJournalEntryDeps, postJournalEntry } from "../ledger/post-entry.js";
import type {
  AccountResolver,
  ActorRecord,
  ApprovalRepository,
  ApprovalRequestRecord,
  BrokerPort,
  Clock,
  CustodianFileRecord,
  CustodianFileRepository,
  CustomerRepository,
  IdGenerator,
  LedgerAccountDirectory,
  LedgerRepository,
  ReconBreakRecord,
  ReconRunRecord,
  ReconSighting,
  ReconciliationRepository,
} from "../ports.js";
import { type ApprovalOutcome, fileApproval, payloadOf } from "./approvals.js";

/* ------------------------------------------------------------------ */
/* The ledger's view of a business date, in the custodian's format      */
/* ------------------------------------------------------------------ */

export interface LedgerSnapshotDeps {
  readonly ledger: LedgerRepository;
  readonly resolver: AccountResolver;
  readonly accounts: LedgerAccountDirectory;
  readonly clock: Clock;
}

/**
 * Positions, settled cash and the day's journal entries for every customer,
 * as the ledger knows them now for the close of `date`. Both the simulator
 * and the reconciliation run read this, so a break is always a difference in
 * *data*, never in projection.
 */
export async function ledgerSnapshotRows(deps: LedgerSnapshotDeps, date: string): Promise<readonly CustodianRow[]> {
  const cutoff = { effectiveAt: endOfBusinessDay(date), publishedAt: deps.clock.now() };
  const rows: CustodianRow[] = [];

  for (const customerId of await deps.accounts.customersWithAccounts()) {
    const symbols = await deps.accounts.positionSymbols(customerId);
    const accounts = await deps.resolver.forCustomer(customerId, symbols);
    const balances = await deriveCustomerBalances({ ledger: deps.ledger }, customerId, accounts, symbols, cutoff);

    for (const [symbol, units] of balances.positionsMicro) {
      rows.push({ section: "positions", customerId, key: symbol, quantity: units, description: "" });
    }
    rows.push({ section: "cash", customerId, key: "USD", quantity: balances.settledCents, description: "" });

    const entries = await deps.ledger.listForCustomer(customerId, cutoff);
    for (const entry of entries) {
      if (businessDate(entry.effectiveAt) !== date) continue;
      const primary = entry.postings.find((p) => p.commodity === "USD") ?? entry.postings[0];
      rows.push({
        section: "transactions",
        customerId,
        key: entry.id,
        quantity: primary ? (primary.quantity < 0n ? -primary.quantity : primary.quantity) : 0n,
        description: entry.description,
      });
    }
  }
  return rows;
}

const sha256 = (content: string): string => createHash("sha256").update(content).digest("hex");

/* ------------------------------------------------------------------ */
/* Custodian file simulator                                             */
/* ------------------------------------------------------------------ */

export interface GenerateCustodianFileDeps extends LedgerSnapshotDeps {
  readonly custodianFiles: CustodianFileRepository;
  readonly ids: IdGenerator;
}

export interface GenerateCustodianFileResult {
  readonly file: CustodianFileRecord;
  readonly rows: number;
  readonly tampered: boolean;
}

/**
 * We have no real custodian, so the file is built from our own ledger as of
 * the prior close and labelled `simulator`. A tamper is applied *after* the
 * projection, so the reconciliation must catch it the same way it would catch
 * a real discrepancy (ADR-0005).
 */
export async function generateCustodianFile(
  deps: GenerateCustodianFileDeps,
  input: { businessDate: string; tamper?: CustodianTamper },
): Promise<GenerateCustodianFileResult> {
  const clean = await ledgerSnapshotRows(deps, input.businessDate);
  const rows = input.tamper ? tamperCustodianRows(clean, input.tamper) : clean;
  const content = buildCustodianFile(rows);
  const hash = sha256(content);
  const file: CustodianFileRecord = {
    id: deps.ids.next(),
    businessDate: input.businessDate,
    kind: "combined",
    sha256: hash,
    storagePath: `simulator/${input.businessDate}/${hash.slice(0, 16)}.csv`,
    content,
    source: input.tamper ? "simulator:tampered" : "simulator",
    receivedAt: deps.clock.now(),
  };
  await deps.custodianFiles.save(file);
  return { file, rows: rows.length, tampered: input.tamper !== undefined };
}

/* ------------------------------------------------------------------ */
/* Reconciliation run                                                   */
/* ------------------------------------------------------------------ */

export interface RunReconciliationDeps extends LedgerSnapshotDeps {
  readonly custodianFiles: CustodianFileRepository;
  readonly reconciliation: ReconciliationRepository;
  readonly customers: CustomerRepository;
  /** Third column when reachable; never a source of breaks on its own. */
  readonly broker: BrokerPort | null;
  readonly ids: IdGenerator;
}

export type RunReconciliationResult =
  | { readonly status: "no_file"; readonly businessDate: string }
  | {
      readonly status: "completed";
      readonly run: ReconRunRecord;
      readonly file: CustodianFileRecord;
      /** True when the file used is from an earlier date than requested. */
      readonly fileIsStale: boolean;
      readonly breaks: readonly ReconSighting[];
      readonly opened: number;
      readonly refreshed: number;
      readonly matched: { readonly customers: number; readonly positions: number; readonly transactions: number };
    };

export async function runReconciliation(deps: RunReconciliationDeps, input: { businessDate: string }): Promise<RunReconciliationResult> {
  const file = await deps.custodianFiles.latestOnOrBefore(input.businessDate);
  if (!file) return { status: "no_file", businessDate: input.businessDate };

  const ledgerRows = await ledgerSnapshotRows(deps, file.businessDate);
  const run: ReconRunRecord = {
    id: deps.ids.next(),
    businessDate: input.businessDate,
    fileId: file.id,
    status: "running",
    ledgerSnapshotHash: sha256(buildCustodianFile(ledgerRows)),
    startedAt: deps.clock.now(),
    finishedAt: null,
  };
  await deps.reconciliation.createRun(run);

  try {
    const fileRows = parseCustodianFile(file.content);
    const breaks = reconcileRows(ledgerRows, fileRows);
    const sightings = await withBrokerColumn(deps, breaks);
    const { opened, refreshed } = await deps.reconciliation.recordSightings(run, sightings);
    const finishedAt = deps.clock.now();
    await deps.reconciliation.finishRun(run.id, "completed", finishedAt);

    const broken = new Set(breaks.map((b) => `${b.customerId}:${b.category}:${b.key}`));
    const unbroken = (section: CustodianRow["section"], category: ReconBreak["category"]) =>
      ledgerRows.filter((r) => r.section === section && !broken.has(`${r.customerId}:${category}:${r.key}`)).length;
    return {
      status: "completed",
      run: { ...run, status: "completed", finishedAt },
      file,
      fileIsStale: file.businessDate !== input.businessDate,
      breaks: sightings,
      opened,
      refreshed,
      matched: {
        customers: new Set(ledgerRows.map((r) => r.customerId)).size,
        positions: unbroken("positions", "position_units"),
        transactions: unbroken("transactions", "missing_transaction"),
      },
    };
  } catch (error) {
    await deps.reconciliation.finishRun(run.id, "failed", deps.clock.now());
    throw error;
  }
}

/** Broker positions per customer, fetched once per customer and only for position breaks. */
async function withBrokerColumn(deps: RunReconciliationDeps, breaks: readonly ReconBreak[]): Promise<readonly ReconSighting[]> {
  const cache = new Map<string, ReadonlyMap<string, bigint> | null>();
  const brokerPositions = async (customerId: string): Promise<ReadonlyMap<string, bigint> | null> => {
    if (cache.has(customerId)) return cache.get(customerId) ?? null;
    let positions: ReadonlyMap<string, bigint> | null = null;
    const customer = deps.broker ? await deps.customers.findById(customerId) : null;
    if (deps.broker && customer?.brokerAccountId) {
      try {
        positions = new Map((await deps.broker.getPositions(customer.brokerAccountId)).map((p) => [p.symbol, p.unitsMicro]));
      } catch {
        positions = null; // unreachable broker is shown as "—", not as a break
      }
    }
    cache.set(customerId, positions);
    return positions;
  };

  const sightings: ReconSighting[] = [];
  for (const brk of breaks) {
    const positions = brk.category === "position_units" ? await brokerPositions(brk.customerId) : null;
    sightings.push({ ...brk, brokerValue: positions ? (positions.get(brk.key) ?? 0n) : null });
  }
  return sightings;
}

/* ------------------------------------------------------------------ */
/* Closing a break                                                      */
/* ------------------------------------------------------------------ */

export interface CloseBreakDeps {
  readonly reconciliation: ReconciliationRepository;
  readonly clock: Clock;
}

async function requireOpenBreak(deps: { reconciliation: ReconciliationRepository }, id: string): Promise<ReconBreakRecord> {
  const brk = await deps.reconciliation.findBreak(id);
  if (!brk) throw new NotFoundError("Break not found");
  if (brk.status !== "open") throw new ValidationError(`Break is already ${brk.status}`);
  return brk;
}

/** Path (a): a human explains the difference; the ledger is left alone. */
export async function explainBreak(deps: CloseBreakDeps, input: { breakId: string; actorId: string; note: string }): Promise<ReconBreakRecord> {
  if (input.note.trim().length === 0) throw new ValidationError("An explanation is required");
  const brk = await requireOpenBreak(deps, input.breakId);
  const at = deps.clock.now();
  await deps.reconciliation.closeBreak({ id: brk.id, status: "explained", note: input.note.trim(), actorId: input.actorId, entryId: null, at });
  return { ...brk, status: "explained", resolutionNote: input.note.trim(), resolvedByActorId: input.actorId, resolvedAt: at };
}

export interface RequestBreakAdjustmentDeps {
  readonly reconciliation: ReconciliationRepository;
  readonly approvals: ApprovalRepository;
  readonly ids: IdGenerator;
}

/** Path (b): a human asks for an adjusting entry; a *different* human must approve it. */
export async function requestBreakAdjustment(
  deps: RequestBreakAdjustmentDeps,
  input: { breakId: string; requestedBy: ActorRecord; note: string },
) {
  const brk = await requireOpenBreak(deps, input.breakId);
  if (brk.category !== "position_units" && brk.category !== "cash") {
    throw new ValidationError("Only position and cash breaks can be adjusted; transaction breaks are explained");
  }
  const absolute = brk.delta < 0n ? -brk.delta : brk.delta;
  return fileApproval(deps, {
    kind: "recon_adjustment",
    amountCents: brk.category === "cash" ? absolute : 0n,
    payload: { breakId: brk.id, customerId: brk.customerId, category: brk.category, key: brk.key, delta: brk.delta.toString(), note: input.note },
    requestedBy: { id: input.requestedBy.id, actorType: input.requestedBy.actorType },
  });
}

export interface ApplyBreakAdjustmentDeps extends PostJournalEntryDeps {
  readonly reconciliation: ReconciliationRepository;
  readonly resolver: AccountResolver;
}

/** Executor for an approved `recon_adjustment`: posts the entry and closes the break. */
export async function applyBreakAdjustment(
  deps: ApplyBreakAdjustmentDeps,
  request: ApprovalRequestRecord,
  decidedBy: ActorRecord,
): Promise<ApprovalOutcome> {
  const payload = payloadOf(request, "recon_adjustment");
  const brk = await requireOpenBreak(deps, payload.breakId);
  const delta = BigInt(payload.delta);
  const symbols = brk.category === "position_units" ? [brk.key] : [];
  const customer = await deps.resolver.forCustomer(brk.customerId, symbols);
  const clearing = await deps.resolver.clearing(symbols);

  const result = await postJournalEntry(deps, {
    idempotencyKey: `recon:adjust:${brk.id}`,
    kind: "recon_adjustment",
    effectiveAt: deps.clock.now(),
    source: "ops",
    sourceRef: brk.id,
    description: `Reconciliation adjustment · ${brk.category} · ${brk.key}`,
    postings:
      brk.category === "position_units"
        ? postingPatterns.positionAdjustment(customer, clearing, brk.key, delta)
        : postingPatterns.cashAdjustment(customer, clearing, delta),
  });
  await deps.reconciliation.closeBreak({
    id: brk.id,
    status: "resolved",
    note: payload.note,
    actorId: decidedBy.id,
    entryId: result.entry.id,
    at: deps.clock.now(),
  });
  return { breakId: brk.id, entryId: result.entry.id, entry: result.status, delta: payload.delta, category: brk.category, key: brk.key };
}
