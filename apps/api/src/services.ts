import type { Database } from "@corgi/database";
import {
  actors,
  approvalRequests,
  inboundEvents,
  journalEntries,
  ledgerAccounts,
  periodReturns,
  postings,
  reconBreaks,
  taxLots,
  valuations,
} from "@corgi/database";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { AgentReadService, AgentWriteService } from "@corgi/mcp";
import type { CustomerServices } from "./customer/services.js";

export interface ApiServices {
  readonly database: Database;
  /** Signed-in customer surface; composed over the transactional (write) pool. */
  readonly customer: CustomerServices;
  readonly inbox: {
    receive(event: {
      provider: "alpaca" | "plaid" | "persona" | "custodian";
      externalId: string;
      dedupeKey: string;
      eventType: string;
      payload: unknown;
      signatureValid: boolean;
    }): Promise<"inserted" | "duplicate">;
  };
  readonly agentReads: AgentReadService;
  readonly agentWrites: AgentWriteService;
}

export function createServices(database: Database, customer: CustomerServices): ApiServices {
  const agentActor = async () => {
    const [actor] = await database
      .select({ id: actors.id })
      .from(actors)
      .where(and(eq(actors.actorType, "agent"), eq(actors.role, "agent")))
      .limit(1);
    if (!actor) throw new Error("Seed an agent actor before using MCP writes");
    return actor;
  };

  return {
    database,
    customer,
    inbox: {
      async receive(event) {
        const result = await database
          .insert(inboundEvents)
          .values(event)
          .onConflictDoNothing({ target: inboundEvents.dedupeKey })
          .returning({ id: inboundEvents.id });
        return result.length === 0 ? "duplicate" : "inserted";
      },
    },
    agentReads: {
      async getPortfolio(customerId, asOf) {
        const predicates = [eq(valuations.customerId, customerId)];
        if (asOf) predicates.push(lte(valuations.asOfDate, asOf));
        return database
          .select()
          .from(valuations)
          .where(and(...predicates))
          .orderBy(desc(valuations.asOfDate), desc(valuations.version))
          .limit(1);
      },
      async getPerformance(customerId, period, asPublishedOn) {
        const rows = await database
          .select()
          .from(periodReturns)
          .where(eq(periodReturns.customerId, customerId))
          .orderBy(desc(periodReturns.periodEnd), desc(periodReturns.version))
          .limit(20);
        return { period, asPublishedOn: asPublishedOn ?? null, rows };
      },
      async listTransactions(customerId, from, to) {
        const predicates = [eq(ledgerAccounts.customerId, customerId)];
        if (from) predicates.push(gte(journalEntries.effectiveAt, new Date(`${from}T00:00:00Z`)));
        if (to) predicates.push(lte(journalEntries.effectiveAt, new Date(`${to}T23:59:59Z`)));
        return database
          .select({
            entryId: journalEntries.id,
            kind: journalEntries.kind,
            effectiveAt: journalEntries.effectiveAt,
            postedAt: journalEntries.postedAt,
            account: ledgerAccounts.path,
            commodity: postings.commodity,
            quantity: postings.quantity,
          })
          .from(postings)
          .innerJoin(journalEntries, eq(postings.entryId, journalEntries.id))
          .innerJoin(ledgerAccounts, eq(postings.accountId, ledgerAccounts.id))
          .where(and(...predicates))
          .orderBy(desc(journalEntries.effectiveAt));
      },
      async listTaxLots(customerId) {
        return database.select().from(taxLots).where(eq(taxLots.customerId, customerId));
      },
      async getReconciliationBreaks(status) {
        return database
          .select()
          .from(reconBreaks)
          .where(status ? eq(reconBreaks.status, status) : undefined)
          .orderBy(reconBreaks.createdAt);
      },
    },
    agentWrites: {
      async proposeRebalance(customerId, reason) {
        const actor = await agentActor();
        const [request] = await database
          .insert(approvalRequests)
          .values({
            kind: "rebalance",
            amountCents: 0n,
            payload: { customerId, reason },
            requestedByActorId: actor.id,
            requestedByActorType: "agent",
          })
          .returning({ id: approvalRequests.id });
        if (!request) throw new Error("Failed to create approval request");
        return { approvalId: request.id };
      },
      async requestWithdrawal(customerId, amountCents, reason) {
        const actor = await agentActor();
        const [request] = await database
          .insert(approvalRequests)
          .values({
            kind: "withdrawal",
            amountCents,
            payload: { customerId, reason },
            requestedByActorId: actor.id,
            requestedByActorType: "agent",
          })
          .returning({ id: approvalRequests.id });
        if (!request) throw new Error("Failed to create approval request");
        return { approvalId: request.id };
      },
    },
  };
}
