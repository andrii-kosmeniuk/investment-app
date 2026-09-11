import { daysBetween } from "../calendar/index.js";

export type ReconCategory =
  | "position_units"
  | "cash"
  | "missing_transaction"
  | "unexpected_transaction"
  | "price";

export interface ReconValue {
  readonly customerId: string;
  readonly category: ReconCategory;
  readonly key: string;
  readonly value: bigint;
}

export interface ReconBreak {
  readonly customerId: string;
  readonly category: ReconCategory;
  readonly key: string;
  readonly ledgerValue: bigint;
  readonly custodianValue: bigint;
  readonly delta: bigint;
}

/** Zero tolerance on integer quantities; price breaks allow 50 bps (ASSUMPTIONS, ADR-0005). */
export const RECON_TOLERANCE: Readonly<Record<ReconCategory, bigint>> = {
  position_units: 0n,
  cash: 0n,
  missing_transaction: 0n,
  unexpected_transaction: 0n,
  price: 50n,
};

export function diffReconciliation(
  ledger: readonly ReconValue[],
  custodian: readonly ReconValue[],
  toleranceFor: (category: ReconCategory) => bigint = (category) => RECON_TOLERANCE[category],
): readonly ReconBreak[] {
  const identity = (row: ReconValue): string =>
    `${row.customerId}:${row.category}:${row.key}`;
  const ledgerByKey = new Map(ledger.map((row) => [identity(row), row]));
  const custodianByKey = new Map(custodian.map((row) => [identity(row), row]));
  const keys = new Set([...ledgerByKey.keys(), ...custodianByKey.keys()]);
  const breaks: ReconBreak[] = [];

  for (const key of keys) {
    const left = ledgerByKey.get(key);
    const right = custodianByKey.get(key);
    const basis = left ?? right;
    if (!basis) continue;
    const ledgerValue = left?.value ?? 0n;
    const custodianValue = right?.value ?? 0n;
    const delta = custodianValue - ledgerValue;
    const absoluteDelta = delta < 0n ? -delta : delta;
    if (absoluteDelta > toleranceFor(basis.category)) {
      breaks.push({
        customerId: basis.customerId,
        category: basis.category,
        key: basis.key,
        ledgerValue,
        custodianValue,
        delta,
      });
    }
  }
  return breaks;
}

/* ------------------------------------------------------------------ */
/* Aging                                                                */
/* ------------------------------------------------------------------ */

export type AgingBucket = "0-1d" | "2-3d" | "4d+";

/** Days since the business date of the run that first saw the break. */
export function ageInDays(firstSeenBusinessDate: string, today: string): number {
  return Math.max(0, daysBetween(firstSeenBusinessDate, today));
}

export function agingBucket(days: number): AgingBucket {
  if (days <= 1) return "0-1d";
  if (days <= 3) return "2-3d";
  return "4d+";
}

/* ------------------------------------------------------------------ */
/* Custodian file format                                                */
/* ------------------------------------------------------------------ */

/**
 * One CSV per business date, three sections. Quantities are integers in the
 * ledger's own scale (micro-units for positions, cents for cash) so a diff is
 * an exact comparison. Transactions are keyed by the ledger entry id, which is
 * what a real custodian would echo back as our reference.
 *
 *   section,customer_id,key,quantity,description
 *   positions,<uuid>,VTI,2864120,
 *   cash,<uuid>,USD,105500,
 *   transactions,<uuid>,<entry-id>,105500,Deposit settled to cash
 */
export const CUSTODIAN_FILE_HEADER = "section,customer_id,key,quantity,description";

export type CustodianSection = "positions" | "cash" | "transactions";

export interface CustodianRow {
  readonly section: CustodianSection;
  readonly customerId: string;
  readonly key: string;
  readonly quantity: bigint;
  readonly description: string;
}

const SECTION_CATEGORY: Readonly<Record<Exclude<CustodianSection, "transactions">, ReconCategory>> = {
  positions: "position_units",
  cash: "cash",
};

const escapeCsv = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export function buildCustodianFile(rows: readonly CustodianRow[]): string {
  const ordered = [...rows].sort((a, b) =>
    a.section === b.section
      ? a.customerId === b.customerId
        ? a.key.localeCompare(b.key)
        : a.customerId.localeCompare(b.customerId)
      : SECTION_ORDER[a.section] - SECTION_ORDER[b.section],
  );
  const lines = ordered.map((row) =>
    [row.section, row.customerId, row.key, row.quantity.toString(), escapeCsv(row.description)].join(","),
  );
  return [CUSTODIAN_FILE_HEADER, ...lines].join("\n") + "\n";
}

const SECTION_ORDER: Readonly<Record<CustodianSection, number>> = { positions: 0, cash: 1, transactions: 2 };

export class CustodianFileError extends Error {
  override readonly name = "CustodianFileError";
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export function parseCustodianFile(content: string): readonly CustodianRow[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines[0] !== CUSTODIAN_FILE_HEADER) {
    throw new CustodianFileError(`Unexpected header: ${lines[0] ?? "<empty file>"}`);
  }
  return lines.slice(1).map((line, index) => {
    const [section, customerId, key, quantity, description = ""] = splitCsvLine(line);
    if (!section || !(section in SECTION_ORDER) || !customerId || !key || quantity === undefined) {
      throw new CustodianFileError(`Malformed row ${index + 2}: ${line}`);
    }
    if (!/^-?\d+$/.test(quantity)) {
      throw new CustodianFileError(`Row ${index + 2}: quantity must be an integer, got ${quantity}`);
    }
    return { section: section as CustodianSection, customerId, key, quantity: BigInt(quantity), description };
  });
}

/** Positions and cash rows as comparable quantities (transactions are matched by presence, see below). */
export function toReconValues(rows: readonly CustodianRow[]): readonly ReconValue[] {
  return rows.flatMap((row) =>
    row.section === "transactions"
      ? []
      : [{ customerId: row.customerId, category: SECTION_CATEGORY[row.section], key: row.key, value: row.quantity }],
  );
}

/**
 * Transactions compare by presence of the entry id: in the ledger but not the
 * file is `missing_transaction`; in the file but not the ledger is
 * `unexpected_transaction`. Values are 1 (present) / 0 (absent) so the break
 * row reads the same way as the others.
 */
export function transactionBreaks(
  ledgerRows: readonly CustodianRow[],
  custodianRows: readonly CustodianRow[],
): readonly ReconBreak[] {
  const ledgerKeys = new Set(ledgerRows.filter((r) => r.section === "transactions").map((r) => r.key));
  const fileKeys = new Set(custodianRows.filter((r) => r.section === "transactions").map((r) => r.key));
  const missing = ledgerRows
    .filter((r) => r.section === "transactions" && !fileKeys.has(r.key))
    .map((r): ReconBreak => ({ customerId: r.customerId, category: "missing_transaction", key: r.key, ledgerValue: 1n, custodianValue: 0n, delta: -1n }));
  const unexpected = custodianRows
    .filter((r) => r.section === "transactions" && !ledgerKeys.has(r.key))
    .map((r): ReconBreak => ({ customerId: r.customerId, category: "unexpected_transaction", key: r.key, ledgerValue: 0n, custodianValue: 1n, delta: 1n }));
  return [...missing, ...unexpected];
}

/** Full comparison of two files: quantity breaks plus presence breaks. */
export function reconcileRows(
  ledgerRows: readonly CustodianRow[],
  custodianRows: readonly CustodianRow[],
): readonly ReconBreak[] {
  return [
    ...diffReconciliation(toReconValues(ledgerRows), toReconValues(custodianRows)),
    ...transactionBreaks(ledgerRows, custodianRows),
  ];
}

/* ------------------------------------------------------------------ */
/* Tampering (live-fire)                                                */
/* ------------------------------------------------------------------ */

export type CustodianTamper =
  | { readonly kind: "position"; readonly customerId: string; readonly symbol: string; readonly deltaUnitsMicro: bigint }
  | { readonly kind: "cash"; readonly customerId: string; readonly deltaCents: bigint }
  | { readonly kind: "drop_transaction"; readonly customerId: string; readonly entryId: string }
  | { readonly kind: "add_transaction"; readonly customerId: string; readonly entryId: string; readonly quantity: bigint; readonly description: string };

/** Applies a deliberate corruption to a generated file so the run must catch it. */
export function tamperCustodianRows(rows: readonly CustodianRow[], tamper: CustodianTamper): readonly CustodianRow[] {
  switch (tamper.kind) {
    case "position": {
      const existing = rows.find((r) => r.section === "positions" && r.customerId === tamper.customerId && r.key === tamper.symbol);
      if (existing) {
        return rows.map((r) => (r === existing ? { ...r, quantity: r.quantity + tamper.deltaUnitsMicro } : r));
      }
      return [...rows, { section: "positions", customerId: tamper.customerId, key: tamper.symbol, quantity: tamper.deltaUnitsMicro, description: "" }];
    }
    case "cash": {
      const existing = rows.find((r) => r.section === "cash" && r.customerId === tamper.customerId);
      if (existing) return rows.map((r) => (r === existing ? { ...r, quantity: r.quantity + tamper.deltaCents } : r));
      return [...rows, { section: "cash", customerId: tamper.customerId, key: "USD", quantity: tamper.deltaCents, description: "" }];
    }
    case "drop_transaction":
      return rows.filter((r) => !(r.section === "transactions" && r.customerId === tamper.customerId && r.key === tamper.entryId));
    case "add_transaction":
      return [...rows, { section: "transactions", customerId: tamper.customerId, key: tamper.entryId, quantity: tamper.quantity, description: tamper.description }];
  }
}
