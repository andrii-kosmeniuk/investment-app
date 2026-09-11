import { type BrokerPort, type Clock, type IdGenerator, generateCustodianFile, runReconciliation, settleDueTrades } from "@corgi/application";
import {
  DrizzleAccountResolver,
  DrizzleCustodianFileRepository,
  DrizzleCustomerRepository,
  DrizzleLedgerAccountDirectory,
  DrizzleLedgerRepository,
  DrizzleOrderRepository,
  DrizzleReconciliationRepository,
  DrizzleSettlementRepository,
  type TransactionalDatabase,
} from "@corgi/database";
import { businessDate, previousBusinessDay } from "@corgi/domain";
import type { Logger } from "pino";

export interface OperationsJobsOptions {
  readonly db: TransactionalDatabase;
  readonly broker: BrokerPort | null;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly logger: Logger;
}

/**
 * The morning operations jobs. All three are re-runnable: settlement is
 * idempotent per fill, the custodian import is skipped when a file already
 * covers the day, and a reconciliation re-run refreshes open breaks instead
 * of duplicating them (ADR-0005).
 */
export function operationsJobs(options: OperationsJobsOptions) {
  const { db, logger } = options;
  const deps = {
    ledger: new DrizzleLedgerRepository(db),
    resolver: new DrizzleAccountResolver(db),
    accounts: new DrizzleLedgerAccountDirectory(db),
    customers: new DrizzleCustomerRepository(db),
    orders: new DrizzleOrderRepository(db),
    settlements: new DrizzleSettlementRepository(db),
    custodianFiles: new DrizzleCustodianFileRepository(db),
    reconciliation: new DrizzleReconciliationRepository(db),
    broker: options.broker,
    clock: options.clock,
    ids: options.ids,
  };
  const today = () => businessDate(options.clock.now());

  return {
    /** 00:05 ET: move cash for every fill whose contractual T+1 date has arrived. */
    async settleTrades(): Promise<void> {
      const result = await settleDueTrades(deps, today());
      logger.info({ settled: result.settled.length, alreadySettled: result.alreadySettled }, "settlement run");
    },

    /** 06:00 ET: the simulated custodian delivers yesterday's positions, cash and transactions. */
    async importCustodianFile(): Promise<void> {
      const date = previousBusinessDay(today());
      const existing = await deps.custodianFiles.latestOnOrBefore(date);
      if (existing?.businessDate === date) {
        logger.info({ businessDate: date, fileId: existing.id }, "custodian file already imported");
        return;
      }
      const result = await generateCustodianFile(deps, { businessDate: date });
      logger.info({ businessDate: date, fileId: result.file.id, rows: result.rows }, "custodian file imported");
    },

    /** 06:10 ET: three-way compare for yesterday; opens, refreshes and ages breaks. */
    async reconcileCustodian(): Promise<void> {
      const date = previousBusinessDay(today());
      const result = await runReconciliation(deps, { businessDate: date });
      if (result.status === "no_file") {
        logger.warn({ businessDate: date }, "reconciliation skipped: no custodian file");
        return;
      }
      logger.info(
        { businessDate: date, runId: result.run.id, breaks: result.breaks.length, opened: result.opened, refreshed: result.refreshed, stale: result.fileIsStale },
        "reconciliation run",
      );
    },
  };
}
