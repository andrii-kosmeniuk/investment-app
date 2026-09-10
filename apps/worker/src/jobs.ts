import { Cron } from "croner";
import type { Logger } from "pino";

export interface ScheduledJob {
  readonly name: string;
  readonly schedule: string;
  readonly timezone: string;
  run(signal: AbortSignal): Promise<void>;
}

export function financialJobs(handlers: {
  settleTrades(): Promise<void>;
  collectClosingPrices(): Promise<void>;
  valuePortfolios(): Promise<void>;
  importCustodianFile(): Promise<void>;
  reconcileCustodian(): Promise<void>;
}): readonly ScheduledJob[] {
  return [
    {
      name: "settle-t-plus-one",
      schedule: "5 0 * * 1-5",
      timezone: "America/New_York",
      run: () => handlers.settleTrades(),
    },
    {
      name: "collect-daily-closes",
      schedule: "15 20 * * 1-5",
      timezone: "America/New_York",
      run: () => handlers.collectClosingPrices(),
    },
    {
      name: "value-portfolios",
      schedule: "30 20 * * 1-5",
      timezone: "America/New_York",
      run: () => handlers.valuePortfolios(),
    },
    {
      name: "import-custodian-file",
      schedule: "0 6 * * 1-5",
      timezone: "America/New_York",
      run: () => handlers.importCustodianFile(),
    },
    {
      name: "reconcile-custodian",
      schedule: "10 6 * * 1-5",
      timezone: "America/New_York",
      run: () => handlers.reconcileCustodian(),
    },
  ];
}

export function scheduleJobs(
  jobs: readonly ScheduledJob[],
  logger: Logger,
  signal: AbortSignal,
): readonly Cron[] {
  return jobs.map(
    (job) =>
      new Cron(
        job.schedule,
        { timezone: job.timezone, protect: true },
        async () => {
          if (signal.aborted) return;
          const startedAt = Date.now();
          try {
            await job.run(signal);
            logger.info({ job: job.name, durationMs: Date.now() - startedAt }, "job completed");
          } catch (error) {
            logger.error({ job: job.name, error }, "job failed");
          }
        },
      ),
  );
}
