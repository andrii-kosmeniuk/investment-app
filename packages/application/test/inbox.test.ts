import { describe, expect, it } from "vitest";
import {
  type InboxEvent,
  type InboxHandler,
  processInboxBatch,
  recordTransferEvent,
} from "../src/index.js";
import {
  InMemoryInboxRepository,
  InMemoryLedgerRepository,
  fixedClock,
  sequentialIds,
  staticResolver,
} from "./fakes.js";

interface TransferPayload {
  customerId: string;
  transferId: string;
  amountCents: string;
}

function makeDeps() {
  const inbox = new InMemoryInboxRepository();
  const ledger = new InMemoryLedgerRepository();
  const ledgerDeps = {
    ledger,
    clock: fixedClock("2026-09-03T14:30:00Z"),
    ids: sequentialIds(),
    resolver: staticResolver(),
  };
  const handler: InboxHandler = async (event) => {
    const payload = event.payload as TransferPayload;
    await recordTransferEvent(ledgerDeps, {
      customerId: payload.customerId,
      transferId: payload.transferId,
      kind: "settled",
      amountCents: BigInt(payload.amountCents),
      occurredAt: event.receivedAt,
    });
  };
  const handlers = new Map<string, InboxHandler>([["transfer.settled", handler]]);
  return { inbox, ledger, deps: { inbox, handlers } };
}

function event(overrides: Partial<InboxEvent> & Pick<InboxEvent, "dedupeKey">): InboxEvent {
  return {
    provider: "plaid",
    externalId: "tr_1",
    type: "transfer.settled",
    payload: { customerId: "cust-1", transferId: "tr_1", amountCents: "100000" },
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
    const { inbox, ledger, deps } = makeDeps();
    await inbox.receive(event({ dedupeKey: "plaid:webhook:a" }));
    await inbox.receive(event({ dedupeKey: "plaid:sse:b" }));

    const result = await processInboxBatch(deps, 10);

    expect(result.leased).toBe(2);
    expect(result.processed).toBe(2);
    expect(ledger.all).toHaveLength(1);
  });

  it("does not re-lease already-processed events", async () => {
    const { inbox, deps } = makeDeps();
    await inbox.receive(event({ dedupeKey: "k1" }));

    const first = await processInboxBatch(deps, 10);
    const second = await processInboxBatch(deps, 10);

    expect(first.processed).toBe(1);
    expect(second.leased).toBe(0);
  });

  it("fails events with no handler or an invalid signature", async () => {
    const { inbox, ledger, deps } = makeDeps();
    await inbox.receive(event({ dedupeKey: "unknown", type: "mystery.event" }));
    await inbox.receive(event({ dedupeKey: "unsigned", signatureValid: false }));

    const result = await processInboxBatch(deps, 10);

    expect(result.failed).toBe(2);
    expect(result.processed).toBe(0);
    expect(ledger.all).toHaveLength(0);
    expect(inbox.failures.get("unknown")).toMatch(/no handler/);
    expect(inbox.failures.get("unsigned")).toMatch(/signature/);
  });
});
