import {
  type ClearingAccounts,
  type CustomerLedgerAccounts,
  UnbalancedJournalError,
  postingPatterns,
  verifyHashChain,
} from "@corgi/domain";
import { describe, expect, it } from "vitest";
import {
  type PostJournalEntryDeps,
  deriveCustomerBalances,
  postJournalEntry,
} from "../src/index.js";
import { InMemoryLedgerRepository, fixedClock, sequentialIds } from "./fakes.js";

const customer: CustomerLedgerAccounts = {
  settledCash: "cust:settled",
  pendingDeposit: "cust:pending",
  unsettledBuys: "cust:unsettled-buys",
  unsettledSells: "cust:unsettled-sells",
  dividendReceivable: "cust:div-recv",
  bounceRecovery: "cust:bounce",
  dividendIncome: "cust:div-income",
  feeExpense: "cust:fee",
  position: (symbol) => `cust:pos:${symbol}`,
};

const clearing: ClearingAccounts = {
  plaidSweep: "firm:sweep",
  tradingUsd: "firm:trading-usd",
  rounding: "firm:rounding",
  tradingUnits: (symbol) => `firm:trading:${symbol}`,
  custodianStreet: (symbol) => `firm:street:${symbol}`,
};

const day1 = new Date("2026-09-01T14:30:00Z");
const day2 = new Date("2026-09-02T14:30:00Z");
const day3 = new Date("2026-09-03T14:30:00Z");

function makeDeps(): PostJournalEntryDeps & { ledger: InMemoryLedgerRepository } {
  return {
    ledger: new InMemoryLedgerRepository(),
    clock: fixedClock("2026-09-03T14:30:00Z"),
    ids: sequentialIds(),
  };
}

describe("ledger write path", () => {
  it("appends, hash-chains, and derives bitemporal balances", async () => {
    const deps = makeDeps();

    await postJournalEntry(deps, {
      idempotencyKey: "plaid:deposit.pending:d1",
      kind: "deposit_pending",
      effectiveAt: day1,
      postedAt: day1,
      source: "plaid",
      sourceRef: "tr_1",
      description: "ACH debit initiated",
      postings: postingPatterns.depositPending(customer, clearing, 100_000n),
    });
    await postJournalEntry(deps, {
      idempotencyKey: "plaid:deposit.settled:d1",
      kind: "deposit_settled",
      effectiveAt: day2,
      postedAt: day2,
      source: "plaid",
      sourceRef: "tr_1",
      description: "ACH settled",
      postings: postingPatterns.depositSettled(customer, 100_000n),
    });
    await postJournalEntry(deps, {
      idempotencyKey: "alpaca:fill:o1",
      kind: "buy_fill",
      effectiveAt: day3,
      postedAt: day3,
      source: "alpaca",
      sourceRef: "o1",
      description: "Buy VTI",
      postings: postingPatterns.buyFill(customer, clearing, "VTI", 10_000_000n, 50_000n, "lot-1"),
    });

    const entries = deps.ledger.all;
    expect(entries).toHaveLength(3);
    expect(entries[0]?.previousHash).toBeUndefined();
    expect(entries[1]?.previousHash).toBe(entries[0]?.hash);
    expect(entries[2]?.previousHash).toBe(entries[1]?.hash);
    expect(verifyHashChain(entries)).toEqual({ valid: true, brokenAt: null });

    const balances = await deriveCustomerBalances(deps, "cust-1", customer, ["VTI"], {
      effectiveAt: day3,
      publishedAt: day3,
    });
    expect(balances.settledCents).toBe(100_000n);
    expect(balances.pendingDepositCents).toBe(0n);
    expect(balances.unsettledBuysCents).toBe(50_000n);
    expect(balances.availableToTradeCents).toBe(50_000n);
    expect(balances.withdrawableCents).toBe(50_000n);
    expect(balances.positionsMicro.get("VTI")).toBe(10_000_000n);
  });

  it("honours knowledge time: a late-posted correction is invisible until known", async () => {
    const deps = makeDeps();

    await postJournalEntry(deps, {
      idempotencyKey: "plaid:deposit.settled:d1",
      kind: "deposit_settled",
      effectiveAt: day1,
      postedAt: day1,
      source: "plaid",
      sourceRef: "tr_1",
      description: "ACH settled",
      postings: postingPatterns.depositSettled(customer, 100_000n),
    });
    // A fee we learn about on day 3 but which economically applied on day 1.
    await postJournalEntry(deps, {
      idempotencyKey: "custodian:fee:f1",
      kind: "fee",
      effectiveAt: day1,
      postedAt: day3,
      source: "custodian",
      sourceRef: "f1",
      description: "Late fee",
      postings: postingPatterns.fee(customer, 500n),
    });

    const asKnownDay2 = await deriveCustomerBalances(deps, "cust-1", customer, [], {
      effectiveAt: day3,
      publishedAt: day2,
    });
    const asKnownDay3 = await deriveCustomerBalances(deps, "cust-1", customer, [], {
      effectiveAt: day3,
      publishedAt: day3,
    });

    expect(asKnownDay2.settledCents).toBe(100_000n);
    expect(asKnownDay3.settledCents).toBe(99_500n);
  });

  it("is idempotent: replaying the same key does not fork the chain", async () => {
    const deps = makeDeps();
    const command = {
      idempotencyKey: "plaid:deposit.settled:d1",
      kind: "deposit_settled",
      effectiveAt: day1,
      postedAt: day1,
      source: "plaid" as const,
      sourceRef: "tr_1",
      description: "ACH settled",
      postings: postingPatterns.depositSettled(customer, 100_000n),
    };

    const first = await postJournalEntry(deps, command);
    const second = await postJournalEntry(deps, command);

    expect(first.status).toBe("inserted");
    expect(second.status).toBe("duplicate");
    expect(second.entry.hash).toBe(first.entry.hash);
    expect(deps.ledger.all).toHaveLength(1);
  });

  it("rejects an unbalanced entry before it can be persisted", async () => {
    const deps = makeDeps();
    await expect(
      postJournalEntry(deps, {
        idempotencyKey: "bad:1",
        kind: "broken",
        effectiveAt: day1,
        source: "system",
        sourceRef: "x",
        description: "does not balance",
        postings: [
          { accountId: customer.settledCash, commodity: "USD", quantity: 100n },
          { accountId: clearing.plaidSweep, commodity: "USD", quantity: -99n },
        ],
      }),
    ).rejects.toBeInstanceOf(UnbalancedJournalError);
    expect(deps.ledger.all).toHaveLength(0);
  });
});
