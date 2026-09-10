import { describe, expect, it } from "vitest";
import {
  InvalidApprovalError,
  allocateLargestRemainder,
  assertBalanced,
  assertValidDecision,
  microUnits,
  parseUsd,
  timeWeightedReturn,
} from "../src/index.js";

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
