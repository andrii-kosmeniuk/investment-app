import { proposeRebalanceForCustomer, requestWithdrawal } from "@corgi/application";
import type { Database } from "@corgi/database";
import { inboundEvents, journalEntries, ledgerAccounts, postings, taxLots, valuations } from "@corgi/database";
import { endOfBusinessDay } from "@corgi/domain";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { AgentReadService, AgentWriteService } from "@corgi/mcp";
import { loadPerformance } from "./customer/read-models.js";
import type { CustomerServices } from "./customer/services.js";
import { loadReconciliation } from "./ops/read-models.js";

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
    const actor = await customer.actors.findByRole("agent");
    if (!actor || actor.actorType !== "agent") throw new Error("Seed an agent actor before using MCP writes");
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
      // Same knowledge-time semantics as the customer's statement: an agent asking
      // "as published on D" gets exactly what the customer saw that day (ADR-0004).
      async getPerformance(customerId, period, asPublishedOn) {
        const publishedAt = asPublishedOn ? endOfBusinessDay(asPublishedOn) : customer.clock.now();
        const performance = await loadPerformance(customer, customerId, publishedAt);
        // Stored periods are mtd / ytd / inception; the tool's 1W has no stored series (CUT_LIST).
        const stored = ({ "1M": "mtd", YTD: "ytd", ALL: "inception" } as Record<string, string | undefined>)[period] ?? null;
        return {
          period,
          storedPeriod: stored,
          asPublishedOn: asPublishedOn ?? null,
          performance: performance
            ? { ...performance, returns: performance.returns.filter((r) => stored === null || r.period === stored) }
            : null,
        };
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
      // Same rows the ops recon screen shows, aging included (ADR-0005).
      async getReconciliationBreaks(status) {
        const view = await loadReconciliation(customer);
        return { today: view.today, latestRun: view.latestRun, breaks: view.breaks.filter((brk) => !status || brk.status === status) };
      },
    },
    // Agent writes run the same use-cases the operator console uses; the only
    // difference the checker sees is the `agent` tag on the request.
    agentWrites: {
      async proposeRebalance(customerId, reason) {
        const result = await proposeRebalanceForCustomer(customer, { customerId, reason, requestedBy: await agentActor() });
        return result.status === "filed"
          ? { status: "filed", approvalId: result.request.id, legs: result.legs.map((leg) => ({ symbol: leg.symbol, side: leg.side, notionalCents: leg.notionalCents.toString() })) }
          : { status: "in_balance", approvalId: null, legs: [] };
      },
      async requestWithdrawal(customerId, amountCents, reason) {
        const filed = await requestWithdrawal(customer, { customerId, amountCents, reason, requestedBy: await agentActor() });
        return { approvalId: filed.id };
      },
    },
  };
}
