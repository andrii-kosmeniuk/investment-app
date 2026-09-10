import { describe, expect, it } from "vitest";
import {
  InvalidApprovalError,
  allocateLargestRemainder,
  applySplit,
  assertBalanced,
  assertValidDecision,
  cents,
  consumeFifo,
  microUnits,
  parseUsd,
  sealNext,
  timeWeightedReturn,
  valuePosition,
  verifyHashChain,
} from "../src/index.js";
import type { AppendableEntry, LotAvailability } from "../src/index.js";

describe("financial invariants", () => {
  it("rounds exact decimal strings using half-even", () => {
    expect(parseUsd("10.125")).toBe(1012n);
    expect(parseUsd("10.135")).toBe(1014n);
  });

  it("allocates every penny deterministically", () => {
    const result = allocateLargestRemainder(100n, [
      { key: "B", weight: 1n },
      { key: "A", weight: 1n },
      { key: "C", weight: 1n },
    ]);
    expect([...result.values()].reduce((sum, value) => sum + value, 0n)).toBe(100n);
    expect(result.get("A")).toBe(34n);
  });

  it("rejects a journal that does not balance by commodity", () => {
    expect(() =>
      assertBalanced([
        { accountId: "cash", commodity: "USD", quantity: 100n },
        { accountId: "position", commodity: "VTI", quantity: 1n },
      ]),
    ).toThrow("Journal does not balance");
  });

  it("prevents self-approval and all agent decisions", () => {
    const request = {
      id: "approval-1",
      kind: "withdrawal" as const,
      amountCents: 100_000n,
      requestedByActorId: "maker",
      requestedByActorType: "human" as const,
      status: "pending" as const,
      payload: {},
    };
    expect(() =>
      assertValidDecision(request, {
        requestId: request.id,
        decidedByActorId: "maker",
        decidedByActorType: "human",
        decision: "approved",
        reason: "looks good",
      }),
    ).toThrow(InvalidApprovalError);
  });

  it("does not count deposits as investment return", () => {
    expect(
      timeWeightedReturn([
        {
          openingValue: 10_000n,
          externalFlow: 5_000n,
          closingValue: 15_000n,
        },
      ]),
    ).toBe(0);
    expect(microUnits(1_000_000n)).toBe(1_000_000n);
  });
});

function appendable(id: string, postings: AppendableEntry["postings"]): AppendableEntry {
  return {
    id,
    idempotencyKey: id,
    kind: "test",
    effectiveAt: new Date("2026-09-01T00:00:00Z"),
    postedAt: new Date("2026-09-01T00:00:00Z"),
    source: "system",
    sourceRef: id,
    description: "test entry",
    postings,
  };
}

const balanced = [
  { accountId: "a", commodity: "USD", quantity: 100n },
  { accountId: "b", commodity: "USD", quantity: -100n },
];

describe("hash chain", () => {
  it("links each entry to its predecessor and detects tampering", () => {
    const first = sealNext(null, appendable("e1", balanced));
    const second = sealNext(first.hash, appendable("e2", balanced));

    expect(first.previousHash).toBeUndefined();
    expect(second.previousHash).toBe(first.hash);
    expect(verifyHashChain([first, second])).toEqual({ valid: true, brokenAt: null });

    const tampered = {
      ...first,
      postings: [
        { accountId: "a", commodity: "USD", quantity: 200n },
        { accountId: "b", commodity: "USD", quantity: -200n },
      ],
    };
    expect(verifyHashChain([tampered, second]).valid).toBe(false);
    expect(verifyHashChain([tampered, second]).brokenAt).toBe(0);
  });

  it("rejects a chain whose head does not start at genesis", () => {
    const first = sealNext(null, appendable("e1", balanced));
    const second = sealNext(first.hash, appendable("e2", balanced));
    expect(verifyHashChain([second])).toEqual({ valid: false, brokenAt: 0 });
  });
});

describe("corporate actions and lots", () => {
  it("keeps position value unchanged across a 2-for-1 split", () => {
    const before = valuePosition(microUnits(10_000_000n), 10_000_000_000n); // 10 units @ $100
    const after = valuePosition(microUnits(20_000_000n), 5_000_000_000n); // 20 units @ $50
    expect(before).toBe(100_000n);
    expect(after).toBe(before);
  });

  it("doubles units and preserves total basis when a lot splits", () => {
    const lot: LotAvailability = {
      lot: {
        id: "lot-1",
        customerId: "cust-1",
        symbol: "VTI",
        openedEntryId: "e1",
        openedAt: new Date("2026-08-01T00:00:00Z"),
        units: microUnits(6_000_000n),
        basis: cents(60_000n),
      },
      remainingUnits: microUnits(6_000_000n),
      remainingBasis: cents(60_000n),
    };
    const adjusted = applySplit(lot, 2n, 1n);
    expect(adjusted.remainingUnits).toBe(12_000_000n);
    expect(adjusted.remainingBasis).toBe(60_000n);
  });

  it("consumes lots FIFO across lot boundaries", () => {
    const lots: LotAvailability[] = [
      {
        lot: {
          id: "old",
          customerId: "c",
          symbol: "VTI",
          openedEntryId: "e1",
          openedAt: new Date("2026-07-01T00:00:00Z"),
          units: microUnits(6_000_000n),
          basis: cents(600n),
        },
        remainingUnits: microUnits(6_000_000n),
        remainingBasis: cents(600n),
      },
      {
        lot: {
          id: "new",
          customerId: "c",
          symbol: "VTI",
          openedEntryId: "e2",
          openedAt: new Date("2026-08-01T00:00:00Z"),
          units: microUnits(6_000_000n),
          basis: cents(900n),
        },
        remainingUnits: microUnits(6_000_000n),
        remainingBasis: cents(900n),
      },
    ];

    const consumptions = consumeFifo(
      lots,
      microUnits(8_000_000n),
      cents(1_600n),
      new Date("2026-09-01T00:00:00Z"),
    );

    expect(consumptions).toHaveLength(2);
    expect(consumptions[0]).toMatchObject({ lotId: "old", basis: 600n, proceeds: 1_200n });
    expect(consumptions[1]).toMatchObject({ lotId: "new", basis: 300n, proceeds: 400n });
    const realized = consumptions.reduce((sum, c) => sum + c.realizedGain, 0n);
    expect(realized).toBe(700n);
  });
});
