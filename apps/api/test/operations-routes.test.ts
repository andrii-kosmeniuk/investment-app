import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  approvalResponse,
  approvalsResponse,
  decideApprovalResponse,
  filedApprovalResponse,
  inboundEventsResponse,
  liveFireResponse,
  operatorsResponse,
  opsOverviewResponse,
  reconciliationResponse,
  replayEventResponse,
} from "@corgi/contracts";
import { buildApi } from "../src/app.js";
import type { ApiServices } from "../src/services.js";
import { AGENT_ID, AVA_ID, BEN_ID, type FakeState, LIVE_FIRE_TOKEN, OLIVIA_ID, defaultState, fakeCustomerServices, testConfig } from "./customer-fakes.js";

let app: FastifyInstance;
let state: FakeState;

const asOperator = (operatorId?: string) => ({ authorization: `Bearer ${LIVE_FIRE_TOKEN}`, ...(operatorId ? { "x-operator-id": operatorId } : {}) });

async function post(url: string, payload: unknown, operatorId?: string) {
  return app.inject({ method: "POST", url: `/v1${url}`, headers: asOperator(operatorId), payload });
}
async function get(url: string) {
  return app.inject({ method: "GET", url: `/v1${url}`, headers: asOperator() });
}

async function fileWithdrawal(amountCents: string, by = AVA_ID): Promise<string> {
  const response = await post("/ops/approvals/request-withdrawal", { customerId: OLIVIA_ID, amountCents, reason: "Customer asked by phone" }, by);
  expect(response.statusCode).toBe(200);
  const filed = filedApprovalResponse.parse(response.json());
  expect(filed.approvalId).not.toBeNull();
  return filed.approvalId!;
}

beforeEach(async () => {
  state = await defaultState();
  app = await buildApi(testConfig, { customer: fakeCustomerServices(state) } as unknown as ApiServices);
  await app.ready();
});
afterEach(() => app.close());

describe("operator identity", () => {
  it("lists only human operators and requires a known human in X-Operator-Id for actions", async () => {
    const operators = operatorsResponse.parse((await get("/ops/operators")).json());
    expect(operators.operators.map((o) => o.id).sort()).toEqual([AVA_ID, BEN_ID].sort());

    const body = { customerId: OLIVIA_ID, amountCents: "1000", reason: "Customer asked by phone" };
    expect((await post("/ops/approvals/request-withdrawal", body)).json()).toMatchObject({ error: "operator_required" });
    expect((await post("/ops/approvals/request-withdrawal", body, "00000000-0000-4000-8000-000000000999")).statusCode).toBe(404);
    expect((await post("/ops/approvals/request-withdrawal", body, AGENT_ID)).json()).toMatchObject({ error: "operator_not_human" });
  });
});

describe("approvals", () => {
  it("rejects self-approval with 409 and lets a second human approve, which posts the withdrawal", async () => {
    const id = await fileWithdrawal("10000");

    const self = await post(`/ops/approvals/${id}/decide`, { decision: "approved", reason: "Looks fine" }, AVA_ID);
    expect(self.statusCode).toBe(409);
    expect(self.json()).toMatchObject({ error: "invalid_approval" });

    const queue = approvalsResponse.parse((await get("/ops/approvals?status=pending")).json());
    expect(queue.rows).toHaveLength(1);
    expect(queue.rows[0]).toMatchObject({ kind: "withdrawal", amountCents: "10000", requestedBy: { id: AVA_ID, actorType: "human" }, decision: null });

    const entriesBefore = state.entries.length;
    const checked = await post(`/ops/approvals/${id}/decide`, { decision: "approved", reason: "Verified with customer" }, BEN_ID);
    expect(checked.statusCode).toBe(200);
    const decided = decideApprovalResponse.parse(checked.json());
    expect(decided.request.status).toBe("approved");
    expect(decided.request.decision).toMatchObject({ decidedBy: { id: BEN_ID }, decision: "approved" });
    expect(decided.outcome).toMatchObject({ payout: "not_sent" });
    expect(state.entries).toHaveLength(entriesBefore + 1);
    expect(state.entries.at(-1)).toMatchObject({ kind: "withdrawal", idempotencyKey: `approval:${id}` });
  });

  it("refuses a withdrawal above the withdrawable balance and a decision on an already-decided request", async () => {
    const tooMuch = await post("/ops/approvals/request-withdrawal", { customerId: OLIVIA_ID, amountCents: "50000", reason: "Customer asked by phone" }, AVA_ID);
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json()).toMatchObject({ error: "insufficient_funds" });

    const id = await fileWithdrawal("5000");
    expect((await post(`/ops/approvals/${id}/decide`, { decision: "rejected", reason: "Not today" }, BEN_ID)).statusCode).toBe(200);
    expect((await post(`/ops/approvals/${id}/decide`, { decision: "approved", reason: "Changed my mind" }, BEN_ID)).statusCode).toBe(409);
    expect(state.entries.some((entry) => entry.idempotencyKey === `approval:${id}`)).toBe(false);
  });

  it("files a rebalance proposal with the drift legs frozen in the payload", async () => {
    await state.prices.record(
      [
        { symbol: "VXUS", tradeDate: "2026-09-10", price: "60.00", source: "test" },
        { symbol: "BND", tradeDate: "2026-09-10", price: "75.00", source: "test" },
      ],
      new Date("2026-09-10T20:15:00Z"),
    );
    const response = await post("/ops/approvals/propose-rebalance", { customerId: OLIVIA_ID, reason: "Quarterly drift check" }, AVA_ID);
    expect(response.statusCode).toBe(200);
    const filed = filedApprovalResponse.parse(response.json());
    expect(filed.status).toBe("filed");
    expect(filed.legs.map((leg) => `${leg.side}:${leg.symbol}`)).toEqual(expect.arrayContaining(["buy:VXUS", "buy:BND"]));

    const stored = approvalsResponse.parse((await get("/ops/approvals")).json()).rows[0]!;
    expect(stored.kind).toBe("rebalance");
    expect(stored.payload).toMatchObject({ customerId: OLIVIA_ID, asOfDate: "2026-09-10" });
  });
});

describe("reconciliation", () => {
  const runFor = async (businessDate: string) => {
    const response = await post("/ops/reconciliation/run", { businessDate });
    expect(response.statusCode).toBe(200);
    return liveFireResponse.parse(response.json()).summary;
  };

  it("reports no_file before a custodian file exists, then matches a clean simulator file", async () => {
    expect(await runFor("2026-09-10")).toMatchObject({ status: "no_file" });

    const generated = await post("/ops/custodian-file", { businessDate: "2026-09-10" });
    expect(generated.statusCode).toBe(200);
    expect(liveFireResponse.parse(generated.json()).summary).toMatchObject({ source: "simulator", tampered: false });

    expect(await runFor("2026-09-10")).toMatchObject({ status: "completed", breaks: 0, opened: 0, customersMatched: 2 });
    const view = reconciliationResponse.parse((await get("/ops/reconciliation")).json());
    expect(view.latestRun).toMatchObject({ businessDate: "2026-09-10", status: "completed", fileSource: "simulator" });
    expect(view.breaks).toHaveLength(0);
  });

  it("opens a 0–1d break from a tampered file, refreshes it on rerun, and a human explains it closed", async () => {
    const tamper = { kind: "position", customerId: OLIVIA_ID, symbol: "VTI", deltaUnitsMicro: "-500000" };
    expect((await post("/ops/custodian-file", { businessDate: "2026-09-10", tamper })).statusCode).toBe(200);

    expect(await runFor("2026-09-10")).toMatchObject({ status: "completed", breaks: 1, opened: 1, refreshed: 0 });
    expect(await runFor("2026-09-10")).toMatchObject({ breaks: 1, opened: 0, refreshed: 1 });

    let view = reconciliationResponse.parse((await get("/ops/reconciliation")).json());
    expect(view.breaks).toHaveLength(1);
    const brk = view.breaks[0]!;
    expect(brk).toMatchObject({
      customerId: OLIVIA_ID,
      category: "position_units",
      key: "VTI",
      ledgerValue: "2000000",
      custodianValue: "1500000",
      delta: "-500000",
      status: "open",
      ageDays: 0,
      agingBucket: "0-1d",
    });
    expect(view.openByBucket).toMatchObject({ "0-1d": 1 });

    const overview = opsOverviewResponse.parse((await get("/ops/overview")).json());
    expect(overview).toMatchObject({ openBreaks: 1, oldestOpenBreakDays: 0 });

    expect((await post(`/ops/reconciliation/breaks/${brk.id}/explain`, { note: "Custodian late-posted the second fill" })).json()).toMatchObject({ error: "operator_required" });
    const explained = await post(`/ops/reconciliation/breaks/${brk.id}/explain`, { note: "Custodian late-posted the second fill" }, BEN_ID);
    expect(explained.statusCode).toBe(200);

    view = reconciliationResponse.parse((await get("/ops/reconciliation")).json());
    expect(view.breaks[0]).toMatchObject({ status: "explained", resolvedBy: { id: BEN_ID }, resolutionNote: "Custodian late-posted the second fill" });
    expect(view.openByBucket["0-1d"] ?? 0).toBe(0);
  });

  it("adjusts a cash break only through a maker-checker approval that posts the correcting entry", async () => {
    const tamper = { kind: "cash", customerId: OLIVIA_ID, deltaCents: "250" };
    await post("/ops/custodian-file", { businessDate: "2026-09-10", tamper });
    await runFor("2026-09-10");
    const brk = reconciliationResponse.parse((await get("/ops/reconciliation")).json()).breaks[0]!;
    expect(brk).toMatchObject({ category: "cash", delta: "250" });

    const filed = await post(`/ops/reconciliation/breaks/${brk.id}/adjust`, { note: "Book the custodian's figure" }, AVA_ID);
    expect(filed.statusCode).toBe(200);
    const request = approvalResponse.parse(filed.json());
    expect(request).toMatchObject({ kind: "recon_adjustment", status: "pending", payload: { breakId: brk.id, delta: "250" } });

    const entriesBefore = state.entries.length;
    const decided = await post(`/ops/approvals/${request.id}/decide`, { decision: "approved", reason: "Agreed with custodian" }, BEN_ID);
    expect(decided.statusCode).toBe(200);
    expect(state.entries).toHaveLength(entriesBefore + 1);
    expect(state.entries.at(-1)).toMatchObject({ kind: "recon_adjustment", idempotencyKey: `recon:adjust:${brk.id}` });

    const view = reconciliationResponse.parse((await get("/ops/reconciliation")).json());
    expect(view.breaks[0]).toMatchObject({ status: "resolved", resolutionEntryId: state.entries.at(-1)!.id });
  });
});

describe("events and settlement", () => {
  it("replays a stored event through the inbox and gets `duplicate`", async () => {
    const services = fakeCustomerServices(state);
    await services.inbox.receive({
      provider: "plaid",
      externalId: "evt-1",
      dedupeKey: "plaid:transfer.settled:xfer-1",
      type: "transfer.settled",
      payload: { transferId: "xfer-1" },
      signatureValid: true,
      receivedAt: state.now,
    });
    const listed = inboundEventsResponse.parse((await get("/ops/events")).json());
    expect(listed.rows).toHaveLength(1);
    expect(listed.rows[0]).toMatchObject({ dedupeKey: "plaid:transfer.settled:xfer-1", outcome: "pending" });

    const replay = await post(`/ops/events/${listed.rows[0]!.id}/replay`, {});
    expect(replay.statusCode).toBe(200);
    expect(replayEventResponse.parse(replay.json())).toMatchObject({ receive: "duplicate" });
    expect(state.events).toHaveLength(1);
  });

  it("settles nothing when no trade is due and says so", async () => {
    const response = await post("/ops/live-fire/settle-trades", {});
    expect(response.statusCode).toBe(200);
    expect(liveFireResponse.parse(response.json())).toMatchObject({ action: "settle_trades", summary: { settled: 0, stillPending: 0 } });
  });
});
