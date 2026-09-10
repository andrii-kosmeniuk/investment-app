import { describe, expect, it } from "vitest";
import {
  parseAlpacaFillEvent,
  parsePersonaInquiryEvent,
  parsePlaidTransferEvent,
} from "../src/index.js";

describe("parseAlpacaFillEvent", () => {
  it("maps a terminal fill with exact micro-units and e8 price", () => {
    const event = parseAlpacaFillEvent({
      event: "fill",
      execution_id: "exec-1",
      timestamp: "2026-09-03T14:30:00Z",
      price: "100.25",
      order: { id: "ord-1", symbol: "VTI", filled_qty: "10.5" },
    });
    expect(event).toEqual({
      executionId: "exec-1",
      providerOrderId: "ord-1",
      symbol: "VTI",
      cumulativeUnitsMicro: 10_500_000n,
      priceE8: 10_025_000_000n,
      occurredAt: new Date("2026-09-03T14:30:00Z"),
      terminal: true,
    });
  });

  it("flags partial fills as non-terminal and ignores non-fill events", () => {
    expect(
      parseAlpacaFillEvent({
        event: "partial_fill",
        execution_id: "exec-2",
        price: "50",
        order: { id: "ord-1", symbol: "VTI", filled_qty: "1" },
      })?.terminal,
    ).toBe(false);
    expect(parseAlpacaFillEvent({ event: "new", order: { id: "ord-1", symbol: "VTI" } })).toBeNull();
  });
});

describe("parsePlaidTransferEvent", () => {
  it("maps posted/settled to settled and returned to returned with code", () => {
    expect(parsePlaidTransferEvent({ transfer_id: "tr_1", event_type: "pending" })?.kind).toBe(
      "pending",
    );
    expect(parsePlaidTransferEvent({ transfer_id: "tr_1", event_type: "settled" })?.kind).toBe(
      "settled",
    );
    const returned = parsePlaidTransferEvent({
      transfer_id: "tr_1",
      event_type: "returned",
      failure_reason: { ach_return_code: "R01" },
    });
    expect(returned).toMatchObject({ kind: "returned", returnCode: "R01" });
  });

  it("ignores non-material transfer events", () => {
    expect(parsePlaidTransferEvent({ transfer_id: "tr_1", event_type: "created" })).toBeNull();
  });
});

describe("parsePersonaInquiryEvent", () => {
  const build = (status: string, referenceId: string | null = "cust-1") => ({
    data: {
      attributes: {
        name: `inquiry.${status}`,
        payload: {
          data: { attributes: { status, "reference-id": referenceId } },
        },
      },
    },
  });

  it("maps approved/declined by reference id", () => {
    expect(parsePersonaInquiryEvent(build("approved"))).toMatchObject({
      customerId: "cust-1",
      status: "approved",
    });
    expect(parsePersonaInquiryEvent(build("declined"))?.status).toBe("declined");
  });

  it("collapses unknown statuses to pending and requires a reference id", () => {
    expect(parsePersonaInquiryEvent(build("completed"))?.status).toBe("pending");
    expect(parsePersonaInquiryEvent(build("approved", null))).toBeNull();
  });
});
