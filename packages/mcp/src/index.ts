import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface AgentReadService {
  getPortfolio(customerId: string, asOf?: string): Promise<unknown>;
  getPerformance(
    customerId: string,
    period: string,
    asPublishedOn?: string,
  ): Promise<unknown>;
  listTransactions(customerId: string, from?: string, to?: string): Promise<unknown>;
  listTaxLots(customerId: string): Promise<unknown>;
  getReconciliationBreaks(status?: string): Promise<unknown>;
}

export interface AgentWriteService {
  /** Files drift legs for human approval; `in_balance` when there is nothing to trade. */
  proposeRebalance(
    customerId: string,
    reason: string,
  ): Promise<{
    status: "filed" | "in_balance";
    approvalId: string | null;
    legs: readonly { symbol: string; side: "buy" | "sell"; notionalCents: string }[];
  }>;
  requestWithdrawal(
    customerId: string,
    amountCents: bigint,
    reason: string,
  ): Promise<{ approvalId: string }>;
}

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, bigintReplacer) }],
});

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export function createAgentServer(
  reads: AgentReadService,
  writes: AgentWriteService,
): McpServer {
  const server = new McpServer({ name: "corgi-invest", version: "0.1.0" });

  server.tool(
    "get_portfolio",
    "Read a customer's positions, cash and valuation at an optional effective date.",
    { customerId: z.string().uuid(), asOf: z.string().date().optional() },
    async ({ customerId, asOf }) => textResult(await reads.getPortfolio(customerId, asOf)),
  );
  server.tool(
    "get_performance",
    "Read current or historically published performance.",
    {
      customerId: z.string().uuid(),
      period: z.enum(["1W", "1M", "YTD", "ALL"]),
      asPublishedOn: z.string().datetime().optional(),
    },
    async ({ customerId, period, asPublishedOn }) =>
      textResult(await reads.getPerformance(customerId, period, asPublishedOn)),
  );
  server.tool(
    "list_transactions",
    "List immutable customer transactions.",
    {
      customerId: z.string().uuid(),
      from: z.string().date().optional(),
      to: z.string().date().optional(),
    },
    async ({ customerId, from, to }) =>
      textResult(await reads.listTransactions(customerId, from, to)),
  );
  server.tool(
    "list_tax_lots",
    "List remaining FIFO tax lots and basis.",
    { customerId: z.string().uuid() },
    async ({ customerId }) => textResult(await reads.listTaxLots(customerId)),
  );
  server.tool(
    "get_reconciliation_breaks",
    "List custodian reconciliation breaks and aging.",
    { status: z.enum(["open", "explained", "resolved"]).optional() },
    async ({ status }) => textResult(await reads.getReconciliationBreaks(status)),
  );
  server.tool(
    "propose_rebalance",
    "Value the customer at the latest closes, compute drift legs against their model and file them in the human approval queue. Never submits orders.",
    { customerId: z.string().uuid(), reason: z.string().min(10).max(500) },
    async ({ customerId, reason }) =>
      textResult(await writes.proposeRebalance(customerId, reason)),
  );
  server.tool(
    "request_withdrawal",
    "Create a withdrawal request in the human approval queue. Never moves money.",
    {
      customerId: z.string().uuid(),
      amountCents: z.string().regex(/^[1-9]\d*$/),
      reason: z.string().min(10).max(500),
    },
    async ({ customerId, amountCents, reason }) =>
      textResult(await writes.requestWithdrawal(customerId, BigInt(amountCents), reason)),
  );

  return server;
}
