import {
  type Clock,
  type IdGenerator,
  type MarketDataPort,
  collectDailyCloses,
  restateForCorrectedCloses,
  valuePortfolios,
} from "@corgi/application";
import {
  DrizzleAccountResolver,
  DrizzleLedgerAccountDirectory,
  DrizzleLedgerRepository,
  DrizzleModelCatalog,
  DrizzlePeriodReturnRepository,
  DrizzlePriceRepository,
  DrizzleValuationRepository,
  type TransactionalDatabase,
} from "@corgi/database";
import { addDays, businessDate } from "@corgi/domain";
import type { Logger } from "pino";

export interface ValuationJobsOptions {
  readonly db: TransactionalDatabase;
  readonly marketData: MarketDataPort;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly logger: Logger;
  /** How many calendar days back each nightly run re-checks; catches late feeds and missed runs. */
  readonly lookbackDays: number;
}

/**
 * The two nightly financial jobs. Both are safe to re-run: closes and
 * valuations are versioned append-only rows and identical results write
 * nothing, so the lookback window simply heals gaps and surfaces corrections.
 */
export function valuationJobs(options: ValuationJobsOptions) {
  const { db, logger } = options;
  const deps = {
    ledger: new DrizzleLedgerRepository(db),
    resolver: new DrizzleAccountResolver(db),
    accounts: new DrizzleLedgerAccountDirectory(db),
    prices: new DrizzlePriceRepository(db),
    valuations: new DrizzleValuationRepository(db),
    returns: new DrizzlePeriodReturnRepository(db),
    models: new DrizzleModelCatalog(db),
    marketData: options.marketData,
    clock: options.clock,
    ids: options.ids,
  };

  const window = () => {
    const to = businessDate(options.clock.now());
    return { from: addDays(to, -options.lookbackDays), to };
  };

  return {
    /** 20:15 ET: pull daily bars for the held + model universe; restate anyone hit by a corrected close. */
    async collectClosingPrices(): Promise<void> {
      const result = await collectDailyCloses(deps, window());
      logger.info(
        { symbols: result.symbols.length, recorded: result.recorded.length, corrections: result.corrections.length },
        "daily closes collected",
      );
      if (result.corrections.length === 0) return;
      const restated = await restateForCorrectedCloses(deps, result.corrections);
      for (const outcome of restated) {
        logger.warn(
          { customerId: outcome.customerId, fromDate: outcome.fromDate, reason: outcome.reason, dates: outcome.dates.length },
          "customer restated after corrected close",
        );
      }
    },

    /** 20:30 ET: value every customer for each weekday in the window and compute period returns. */
    async valuePortfolios(): Promise<void> {
      const runs = await valuePortfolios(deps, { ...window(), reason: "scheduled" });
      const summary = { recorded: 0, unchanged: 0, unavailable: 0, empty: 0, returnsWritten: 0 };
      for (const run of runs) {
        summary[run.valuation.status] += 1;
        summary.returnsWritten += run.returns.filter((r) => r.status === "recorded").length;
        if (run.valuation.status === "unavailable") {
          logger.warn({ customerId: run.customerId, asOfDate: run.asOfDate, missing: run.valuation.missingSymbols }, "valuation unavailable");
        }
      }
      logger.info(summary, "portfolios valued");
    },
  };
}
