import { createHash } from "node:crypto";

export interface CustodianPosition {
  readonly customerId: string;
  readonly symbol: string;
  readonly unitsMicro: bigint;
  readonly settledCashCents?: never;
}

export interface CustodianCash {
  readonly customerId: string;
  readonly symbol?: never;
  readonly unitsMicro?: never;
  readonly settledCashCents: bigint;
}

export interface CustodianFile {
  readonly businessDate: string;
  readonly csv: string;
  readonly sha256: string;
  readonly source: "simulated";
}

export function generateCustodianFile(
  businessDate: string,
  positions: readonly CustodianPosition[],
  cash: readonly CustodianCash[],
): CustodianFile {
  const lines = [
    "record_type,business_date,customer_id,symbol,units_micro,settled_cash_cents",
    ...positions
      .slice()
      .sort((a, b) => `${a.customerId}:${a.symbol}`.localeCompare(`${b.customerId}:${b.symbol}`))
      .map(
        (row) =>
          `POSITION,${businessDate},${row.customerId},${row.symbol},${row.unitsMicro.toString()},`,
      ),
    ...cash
      .slice()
      .sort((a, b) => a.customerId.localeCompare(b.customerId))
      .map(
        (row) =>
          `CASH,${businessDate},${row.customerId},,,${row.settledCashCents.toString()}`,
      ),
  ];
  const csv = `${lines.join("\n")}\n`;
  return {
    businessDate,
    csv,
    sha256: createHash("sha256").update(csv).digest("hex"),
    source: "simulated",
  };
}
