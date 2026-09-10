import { type CustomerLedgerAccounts, postingPatterns } from "@corgi/domain";
import { describe, expect, it } from "vitest";
import {
  type InboxEvent,
  type InboxHandler,
  type InboxProcessorDeps,
  processInboxBatch,
} from "../src/index.js";
import {
  InMemoryInboxRepository,
  InMemoryLedgerRepository,
  fixedClock,
  sequentialIds,
} from "./fakes.js";

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

const settledHandler: InboxHandler = (event) => {
  const payload = event.payload as { externalId: string; amountCents: string };
  return [
    {
      idempotencyKey: `plaid:transfer.settled:${payload.externalId}`,
      kind: "deposit_settled",
      effectiveAt: event.receivedAt,
      source: "plaid",
      sourceRef: payload.externalId,
      description: "ACH settled",
      postings: postingPatterns.depositSettled(customer, BigInt(payload.amountCents)),
    },
  ];
};

function makeDeps(): InboxProcessorDeps & {
  ledger: InMemoryLedgerRepository;
  inbox: InMemoryInboxRepository;
} {
  return {
    inbox: new InMemoryInboxRepository(),
    ledger: new InMemoryLedgerRepository(),
    clock: fixedClock("2026-09-03T14:30:00Z"),
    ids: sequentialIds(),
    handlers: new Map([["transfer.settled", settledHandler]]),
  };
}

function event(overrides: Partial<InboxEvent> & Pick<InboxEvent, "dedupeKey">): InboxEvent {
  return {
    provider: "plaid",
    externalId: "tr_1",
    type: "transfer.settled",
    payload: { externalId: "tr_1", amountCents: "100000" },
    signatureValid: true,
    receivedAt: new Date("2026-09-03T14:30:00Z"),
    ...overrides,
  };
}

describe("inbox processor", () => {
  it("dedupes identical deliveries at ingress", async () => {
    const inbox = new InMemoryInboxRepository();
    expect(await inbox.receive(event({ dedupeKey: "k1" }))).toBe("inserted");
    expect(await inbox.receive(event({ dedupeKey: "k1" }))).toBe("duplicate");
  });

  it("applies the same settlement seen on two channels exactly once", async () => {
    const deps = makeDeps();
    // Same transfer reported by both a webhook and an SSE event: distinct
    // dedupe keys at ingress, but one shared ledger idempotency key.
    await deps.inbox.receive(event({ dedupeKey: "plaid:webhook:a" }));
    await deps.inbox.receive(event({ dedupeKey: "plaid:sse:b" }));

    const result = await processInboxBatch(deps, 10);

    expect(result.leased).toBe(2);
    expect(result.processed).toBe(2);
    expect(result.duplicateEffects).toBe(1);
    expect(deps.ledger.all).toHaveLength(1);
  });

  it("does not re-lease already-processed events", async () => {
    const deps = makeDeps();
    await deps.inbox.receive(event({ dedupeKey: "k1" }));

    const first = await processInboxBatch(deps, 10);
    const second = await processInboxBatch(deps, 10);

    expect(first.processed).toBe(1);
    expect(second.leased).toBe(0);
  });

  it("fails events with no handler or an invalid signature", async () => {
    const deps = makeDeps();
    await deps.inbox.receive(event({ dedupeKey: "unknown", type: "mystery.event" }));
    await deps.inbox.receive(event({ dedupeKey: "unsigned", signatureValid: false }));

    const result = await processInboxBatch(deps, 10);

    expect(result.failed).toBe(2);
    expect(result.processed).toBe(0);
    expect(deps.ledger.all).toHaveLength(0);
    expect(deps.inbox.failures.get("unknown")).toMatch(/no handler/);
    expect(deps.inbox.failures.get("unsigned")).toMatch(/signature/);
  });
});
