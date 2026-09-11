import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  type RestateResult,
  applyStockSplit,
  collectDailyCloses,
  recordCloses,
  recordDividend,
  restateForCorrectedCloses,
  valuePortfolios,
} from "@corgi/application";
import {
  type LiveFireResponse,
  type RestatementsResponse,
  collectClosesRequest,
  correctedCloseRequest,
  lateDividendRequest,
  runValuationRequest,
  stockSplitRequest,
} from "@corgi/contracts";
import { bearerToken } from "../auth/session.js";
import { loadRestatements } from "../customer/read-models.js";
import type { CustomerServices } from "../customer/services.js";
import { HttpError, parseBody, requireProvider, toHttp } from "../http.js";
import { registerOperationsRoutes } from "./operations-routes.js";

function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function summarize(results: readonly RestateResult[]): LiveFireResponse["restatements"] {
  return results.map((result) => ({
    customerId: result.customerId,
    fromDate: result.fromDate,
    reason: result.reason,
    dates: [...result.dates],
    valuationsRewritten: result.valuations.filter((v) => v.status === "recorded").length,
    returnsRewritten: result.returns.filter((r) => r.status === "recorded").length,
  }));
}

/**
 * Operator surface: the restatement audit and the live-fire console (PLAN §8).
 * Every action goes through the same use-cases the nightly jobs use — nothing
 * here writes a table directly — so what the console demonstrates is the real
 * behaviour, not a scripted one. Guarded by a separate operator token.
 */
export async function registerOpsRoutes(app: FastifyInstance, services: CustomerServices): Promise<void> {
  app.setErrorHandler((error, request, reply) => {
    const mapped = toHttp(error);
    if (mapped.statusCode >= 500) request.log.error({ err: error }, "ops route failed");
    return reply.code(mapped.statusCode).send({ ...mapped.body, requestId: request.id });
  });

  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (services.liveFireToken === null) {
      return reply.code(503).send({ error: "live_fire_not_configured", message: "LIVE_FIRE_TOKEN is not set in this environment" });
    }
    if (!tokenMatches(bearerToken(request.headers.authorization), services.liveFireToken)) {
      return reply.code(401).send({ error: "unauthorized", message: "Operator token required" });
    }
  });

  const deps = {
    ledger: services.ledger,
    resolver: services.resolver,
    accounts: services.accounts,
    prices: services.prices,
    valuations: services.valuations,
    returns: services.returns,
    taxLots: services.taxLots,
    models: services.models,
    clock: services.clock,
    ids: services.ids,
  };

  registerOperationsRoutes(app, services);

  app.get("/ops/restatements", async (request): Promise<RestatementsResponse> => {
    const query = request.query as { customerId?: string };
    return { rows: await loadRestatements(services, query.customerId) };
  });

  app.post("/ops/live-fire/corrected-close", async (request): Promise<LiveFireResponse> => {
    const body = parseBody(correctedCloseRequest, request.body);
    const { recorded, corrections } = await recordCloses(deps, [
      { symbol: body.symbol, tradeDate: body.tradeDate, price: body.close, source: "ops:corrected-close" },
    ]);
    const restatements = await restateForCorrectedCloses(deps, corrections);
    const written = recorded[0];
    return {
      action: "corrected_close",
      summary: {
        symbol: body.symbol,
        tradeDate: body.tradeDate,
        close: body.close,
        priceVersion: written?.version ?? null,
        changed: written !== undefined,
        customersRestated: restatements.length,
      },
      restatements: summarize(restatements),
    };
  });

  app.post("/ops/live-fire/late-dividend", async (request): Promise<LiveFireResponse> => {
    const body = parseBody(lateDividendRequest, request.body);
    const result = await recordDividend(deps, {
      customerId: body.customerId,
      symbol: body.symbol,
      exDate: body.exDate,
      payDate: body.payDate,
      amountCents: BigInt(body.amountCents),
      sourceRef: `ops:late-dividend:${body.symbol}:${body.exDate}`,
    });
    return {
      action: "late_dividend",
      summary: {
        customerId: body.customerId,
        symbol: body.symbol,
        exDate: body.exDate,
        payDate: body.payDate,
        amountCents: body.amountCents,
        entitlement: result.entitlement.status,
        payment: result.payment?.status ?? "deferred",
      },
      restatements: summarize(result.restatement ? [result.restatement] : []),
    };
  });

  app.post("/ops/live-fire/stock-split", async (request): Promise<LiveFireResponse> => {
    const body = parseBody(stockSplitRequest, request.body);
    const result = await applyStockSplit(deps, {
      customerId: body.customerId,
      symbol: body.symbol,
      numerator: BigInt(body.numerator),
      denominator: BigInt(body.denominator),
      effectiveDate: body.effectiveDate,
      sourceRef: `ops:split:${body.symbol}:${body.effectiveDate}`,
    });
    return {
      action: "stock_split",
      summary: {
        customerId: body.customerId,
        symbol: body.symbol,
        ratio: `${body.numerator}-for-${body.denominator}`,
        effectiveDate: body.effectiveDate,
        entry: result.entry.status,
        unitsBefore: result.unitsBefore.toString(),
        unitsAfter: result.unitsAfter.toString(),
        lotsAdjusted: result.lotsAdjusted,
        pricesAdjusted: result.pricesAdjusted,
        valuationDate: result.latestValue?.asOfDate ?? null,
        valueBeforeCents: result.latestValue ? result.latestValue.beforeCents.toString() : null,
        valueAfterCents: result.latestValue ? result.latestValue.afterCents.toString() : null,
        valueUnchanged: result.latestValue ? result.latestValue.beforeCents === result.latestValue.afterCents : null,
      },
      restatements: summarize(result.restatement ? [result.restatement] : []),
    };
  });

  app.post("/ops/live-fire/run-valuation", async (request): Promise<LiveFireResponse> => {
    const body = parseBody(runValuationRequest, request.body);
    if (body.from > body.to) throw new HttpError(400, "invalid_request", "from must not be after to");
    const runs = await valuePortfolios(deps, {
      from: body.from,
      to: body.to,
      reason: "ops:run-valuation",
      ...(body.customerId ? { customerId: body.customerId } : {}),
    });
    return {
      action: "run_valuation",
      summary: {
        from: body.from,
        to: body.to,
        customerId: body.customerId ?? null,
        recorded: runs.filter((r) => r.valuation.status === "recorded").length,
        unchanged: runs.filter((r) => r.valuation.status === "unchanged").length,
        unavailable: runs.filter((r) => r.valuation.status === "unavailable").length,
        empty: runs.filter((r) => r.valuation.status === "empty").length,
        returnsWritten: runs.flatMap((r) => r.returns).filter((r) => r.status === "recorded").length,
      },
      restatements: [],
    };
  });

  app.post("/ops/live-fire/collect-closes", async (request): Promise<LiveFireResponse> => {
    const body = parseBody(collectClosesRequest, request.body);
    const marketData = requireProvider(services.marketData, "alpaca_market_data");
    const result = await collectDailyCloses({ ...deps, marketData }, body);
    const restatements = await restateForCorrectedCloses(deps, result.corrections);
    return {
      action: "collect_closes",
      summary: {
        from: body.from,
        to: body.to,
        symbols: result.symbols.join(","),
        recorded: result.recorded.length,
        corrections: result.corrections.length,
        customersRestated: restatements.length,
      },
      restatements: summarize(restatements),
    };
  });
}
