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

export function diffReconciliation(
  ledger: readonly ReconValue[],
  custodian: readonly ReconValue[],
  toleranceFor: (category: ReconCategory) => bigint = () => 0n,
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
