import { describe, expect, it } from "vitest";
import {
  type CustodianRow,
  type CustomerLedgerAccounts,
  type ClearingAccounts,
  CustodianFileError,
  ageInDays,
  agingBucket,
  assertBalanced,
  buildCustodianFile,
  parseCustodianFile,
  postingPatterns,
  reconcileRows,
  tamperCustodianRows,
} from "../src/index.js";

const OLIVIA = "a428b39f-5a4e-4f9a-83e0-65b25a4af886";

const rows: readonly CustodianRow[] = [
  { section: "positions", customerId: OLIVIA, key: "VTI", quantity: 2_864_120n, description: "" },
  { section: "cash", customerId: OLIVIA, key: "USD", quantity: 105_500n, description: "" },
  { section: "transactions", customerId: OLIVIA, key: "entry-1", quantity: 105_500n, description: 'Deposit settled, "ACH"' },
];

describe("custodian file format", () => {
  it("round-trips through CSV, including quoted descriptions", () => {
    const file = buildCustodianFile(rows);
    expect(file.split("\n")[0]).toBe("section,customer_id,key,quantity,description");
    expect(parseCustodianFile(file)).toEqual(rows);
  });

  it("orders sections deterministically so the sha256 is stable", () => {
    const shuffled = [rows[2]!, rows[0]!, rows[1]!];
    expect(buildCustodianFile(shuffled)).toBe(buildCustodianFile(rows));
  });

  it("rejects a file with the wrong header or a non-integer quantity", () => {
    expect(() => parseCustodianFile("a,b,c\n")).toThrow(CustodianFileError);
    expect(() => parseCustodianFile(`section,customer_id,key,quantity,description\npositions,${OLIVIA},VTI,1.5,\n`)).toThrow(
      CustodianFileError,
    );
  });
});

describe("reconciliation", () => {
  it("matches an untouched file with zero breaks", () => {
    expect(reconcileRows(rows, rows)).toEqual([]);
  });

  it("flags a tampered position with the exact delta", () => {
    const tampered = tamperCustodianRows(rows, { kind: "position", customerId: OLIVIA, symbol: "VTI", deltaUnitsMicro: 1_000n });
    const breaks = reconcileRows(rows, tampered);
    expect(breaks).toEqual([
      { customerId: OLIVIA, category: "position_units", key: "VTI", ledgerValue: 2_864_120n, custodianValue: 2_865_120n, delta: 1_000n },
    ]);
  });

  it("flags cash to the cent and a dropped transaction as missing", () => {
    let tampered = tamperCustodianRows(rows, { kind: "cash", customerId: OLIVIA, deltaCents: -1n });
    tampered = tamperCustodianRows(tampered, { kind: "drop_transaction", customerId: OLIVIA, entryId: "entry-1" });
    const breaks = reconcileRows(rows, tampered);
    expect(breaks.map((b) => [b.category, b.delta])).toEqual([
      ["cash", -1n],
      ["missing_transaction", -1n],
    ]);
  });

  it("flags a transaction only the custodian knows as unexpected", () => {
    const tampered = tamperCustodianRows(rows, {
      kind: "add_transaction",
      customerId: OLIVIA,
      entryId: "phantom",
      quantity: 500n,
      description: "Fee we never booked",
    });
    expect(reconcileRows(rows, tampered)).toEqual([
      { customerId: OLIVIA, category: "unexpected_transaction", key: "phantom", ledgerValue: 0n, custodianValue: 1n, delta: 1n },
    ]);
  });

  it("treats a position the file omits as a break against zero", () => {
    const withoutPosition = rows.filter((r) => r.section !== "positions");
    expect(reconcileRows(rows, withoutPosition)[0]).toMatchObject({ category: "position_units", custodianValue: 0n, delta: -2_864_120n });
  });
});

describe("aging", () => {
  it("counts from the first run's business date and buckets 0-1 / 2-3 / 4+", () => {
    expect(ageInDays("2026-09-11", "2026-09-11")).toBe(0);
    expect(ageInDays("2026-09-11", "2026-09-10")).toBe(0);
    expect(agingBucket(ageInDays("2026-09-10", "2026-09-11"))).toBe("0-1d");
    expect(agingBucket(ageInDays("2026-09-08", "2026-09-11"))).toBe("2-3d");
    expect(agingBucket(ageInDays("2026-09-01", "2026-09-11"))).toBe("4d+");
  });
});

describe("operations posting patterns balance", () => {
  const customer: CustomerLedgerAccounts = {
    settledCash: "c:cash",
    pendingDeposit: "c:pending",
    unsettledBuys: "c:ubuys",
    unsettledSells: "c:usells",
    dividendReceivable: "c:divr",
    bounceRecovery: "c:bounce",
    dividendIncome: "c:divi",
    feeExpense: "c:fee",
    position: (symbol) => `c:pos:${symbol}`,
  };
  const clearing: ClearingAccounts = {
    plaidSweep: "f:sweep",
    tradingUsd: "f:usd",
    rounding: "f:rounding",
    tradingUnits: (symbol) => `f:units:${symbol}`,
    custodianStreet: (symbol) => `f:street:${symbol}`,
  };

  it("sell fill moves units out and proceeds into unsettled sells", () => {
    const postings = postingPatterns.sellFill(customer, clearing, "VTI", 1_000_000n, 29_705n);
    assertBalanced(postings);
    expect(postings.find((p) => p.accountId === "c:pos:VTI")?.quantity).toBe(-1_000_000n);
    expect(postings.find((p) => p.accountId === "c:usells")?.quantity).toBe(29_705n);
  });

  it("settlement, adjustments and bounce recovery balance", () => {
    assertBalanced(postingPatterns.settleSell(customer, 29_705n));
    assertBalanced(postingPatterns.positionAdjustment(customer, clearing, "VTI", -1_000n));
    assertBalanced(postingPatterns.cashAdjustment(customer, clearing, 1n));
    assertBalanced(postingPatterns.bounceRecovered(customer, clearing, 5_500n));
  });
});
