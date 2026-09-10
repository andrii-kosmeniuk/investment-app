import {
  type CustomerProfile,
  NotFoundError,
  type PerformanceView,
  type PeriodReturnRecord,
  RETURN_PERIODS,
  type ReturnPeriod,
  type ValuationRecord,
  buildActivityRows,
  buildDepositProgress,
  buildOnboardingView,
  buildPerformanceView,
  buildPortfolioView,
  deriveCustomerBalances,
} from "@corgi/application";
import type {
  ActivityResponse,
  BankAccountResponse,
  CustomerSummary,
  ModelResponse,
  OnboardingResponse,
  PerformanceResponse,
  PortfolioResponse,
  RestatementAuditRow,
  StatementResponse,
  TransfersResponse,
} from "@corgi/contracts";
import { bpsE4ToReturn, businessDate, endOfBusinessDay } from "@corgi/domain";
import type { CustomerServices } from "./services.js";

const str = (value: bigint): string => value.toString();
const iso = (value: Date): string => value.toISOString();

/* ------------------------------------------------------------------ */
/* Performance (ADR-0004)                                               */
/* ------------------------------------------------------------------ */

function toPerformanceResponse(view: PerformanceView): PerformanceResponse {
  return {
    asOfDate: view.asOfDate,
    valueCents: str(view.valueCents),
    status: view.status,
    version: view.version,
    computedAt: iso(view.computedAt),
    restated: view.restated ? { at: iso(view.restated.at), previous: str(view.restated.previous), reason: view.restated.reason } : null,
    returns: view.returns.map((r) => ({
      period: r.period,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      twr: r.twr,
      mwr: r.mwr,
      flowsCents: str(r.flowsCents),
      version: r.version,
      restated: r.restated ? { at: iso(r.restated.at), previous: r.restated.previous, reason: r.restated.reason } : null,
    })),
  };
}

/**
 * Headline performance as known at `publishedAt`. Only versions computed at or
 * before that instant are visible, so the same code serves "current" and the
 * statement's "as published on …" toggle.
 */
export async function loadPerformance(
  services: CustomerServices,
  customerId: string,
  publishedAt: Date,
): Promise<PerformanceView | null> {
  const series = await services.valuations.series(customerId, { publishedAt });
  const latest = series.at(-1);
  if (!latest) return null;
  const visible = <T extends { computedAt: Date }>(rows: readonly T[]) => rows.filter((row) => row.computedAt <= publishedAt);

  const valuationVersions = visible(await services.valuations.versions(customerId, latest.asOfDate));
  const returnVersions = new Map<ReturnPeriod, readonly PeriodReturnRecord[]>();
  for (const period of RETURN_PERIODS) {
    returnVersions.set(period, visible(await services.returns.versions(customerId, period, latest.asOfDate)));
  }
  return buildPerformanceView({ valuation: latest, valuationVersions, returnVersions });
}

/** Restatement audit rows for one customer or (when `customerId` is undefined) everyone. */
export async function loadRestatements(services: CustomerServices, customerId?: string, limit = 100): Promise<RestatementAuditRow[]> {
  const [valuationRows, returnRows] = await Promise.all([services.valuations.listRestated(limit), services.returns.listRestated(limit)]);
  const rows: RestatementAuditRow[] = [];

  for (const row of valuationRows) {
    if (customerId && row.customerId !== customerId) continue;
    const previous = row.supersedesId
      ? (await services.valuations.versions(row.customerId, row.asOfDate)).find((v) => v.id === row.supersedesId)
      : undefined;
    rows.push(auditRow("valuation", row, null, previous ? str(previous.valueCents) : "", str(row.valueCents)));
  }
  for (const row of returnRows) {
    if (customerId && row.customerId !== customerId) continue;
    const previous = row.supersedesId
      ? (await services.returns.versions(row.customerId, row.period, row.periodEnd)).find((v) => v.id === row.supersedesId)
      : undefined;
    rows.push(
      auditRow("return", { ...row, asOfDate: row.periodEnd }, row.period, previous ? String(bpsE4ToReturn(previous.twrBpsE4)) : "", String(bpsE4ToReturn(row.twrBpsE4))),
    );
  }
  return rows.sort((a, b) => b.computedAt.localeCompare(a.computedAt)).slice(0, limit);
}

function auditRow(
  kind: "valuation" | "return",
  row: Pick<ValuationRecord, "customerId" | "asOfDate" | "version" | "computedAt" | "reason">,
  period: ReturnPeriod | null,
  from: string,
  to: string,
): RestatementAuditRow {
  return { kind, customerId: row.customerId, asOfDate: row.asOfDate, period, version: row.version, computedAt: iso(row.computedAt), reason: row.reason, from, to };
}

export async function loadStatement(services: CustomerServices, customerId: string, asPublishedOn: string | null): Promise<StatementResponse> {
  const publishedAt = asPublishedOn ? endOfBusinessDay(asPublishedOn) : services.clock.now();
  const [performance, series, restatements] = await Promise.all([
    loadPerformance(services, customerId, publishedAt),
    services.valuations.series(customerId, { publishedAt }),
    loadRestatements(services, customerId),
  ]);
  return {
    asPublishedOn,
    publishedAt: iso(publishedAt),
    performance: performance ? toPerformanceResponse(performance) : null,
    series: series.map((v) => ({
      asOfDate: v.asOfDate,
      valueCents: str(v.valueCents),
      cashCents: str(v.cashCents),
      status: v.status,
      version: v.version,
      computedAt: iso(v.computedAt),
      reason: v.reason,
    })),
    restatements: restatements.filter((row) => row.computedAt <= iso(publishedAt)).map(({ customerId: _omit, ...row }) => row),
  };
}

export function toCustomerSummary(profile: CustomerProfile): CustomerSummary {
  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.displayName,
    kycStatus: profile.kycStatus,
    tradingBlocked: profile.tradingBlocked,
  };
}

export async function requireProfile(services: CustomerServices, customerId: string): Promise<CustomerProfile> {
  const profile = await services.directory.findProfile(customerId);
  if (!profile) throw new NotFoundError("Customer not found");
  return profile;
}

export async function loadModels(services: CustomerServices): Promise<readonly ModelResponse[]> {
  const models = await services.models.list();
  return models.map((model) => ({
    id: model.id,
    code: model.code,
    name: model.name,
    riskLevel: model.riskLevel,
    cashBufferBps: model.cashBufferBps,
    allocations: model.allocations.map((allocation) => ({
      symbol: allocation.symbol,
      targetWeightBps: allocation.targetWeightBps,
    })),
  }));
}

export async function loadOnboarding(services: CustomerServices, customerId: string): Promise<OnboardingResponse> {
  const profile = await requireProfile(services, customerId);
  const [latestInquiry, bankAccounts, transfers, assignment] = await Promise.all([
    services.inquiries.latestForCustomer(customerId),
    services.bankAccounts.listForCustomer(customerId),
    services.transfers.listForCustomer(customerId),
    services.portfolios.findForCustomer(customerId),
  ]);
  const view = buildOnboardingView({
    profile,
    latestInquiry,
    hasBankAccount: bankAccounts.length > 0,
    hasDeposit: transfers.some((transfer) => transfer.direction === "deposit"),
    hasModel: assignment !== null,
  });
  return { customer: toCustomerSummary(profile), steps: [...view.steps], identity: view.identity };
}

export async function loadPortfolio(services: CustomerServices, customerId: string): Promise<PortfolioResponse> {
  const now = services.clock.now();
  const asOf = businessDate(now);
  const cutoff = { effectiveAt: now, publishedAt: now };

  const [assignment, heldSymbols, openOrders] = await Promise.all([
    services.portfolios.findForCustomer(customerId),
    services.accounts.positionSymbols(customerId),
    services.orderListing.listOpenForCustomer(customerId),
  ]);
  const model = assignment ? await services.models.findById(assignment.modelId) : null;
  const symbols = [...new Set([...heldSymbols, ...(model?.allocations.map((a) => a.symbol) ?? [])])].sort();

  const accounts = await services.resolver.forCustomer(customerId, symbols);
  const balances = await deriveCustomerBalances({ ledger: services.ledger }, customerId, accounts, symbols, cutoff);
  const [prices, performance] = await Promise.all([
    services.prices.latestCloses([...balances.positionsMicro.keys()], asOf),
    loadPerformance(services, customerId, now),
  ]);

  const view = buildPortfolioView({ customerId, asOf, publishedAt: now, balances, prices, model, openOrders, performance });
  return {
    customerId: view.customerId,
    asOf: view.asOf,
    publishedAt: iso(view.publishedAt),
    value: { cents: view.value.cents === null ? null : str(view.value.cents), status: view.value.status },
    cash: {
      settledCents: str(view.cash.settledCents),
      pendingDepositCents: str(view.cash.pendingDepositCents),
      unsettledBuysCents: str(view.cash.unsettledBuysCents),
      unsettledSellsCents: str(view.cash.unsettledSellsCents),
      availableToInvestCents: str(view.cash.availableToInvestCents),
      availableToWithdrawCents: str(view.cash.availableToWithdrawCents),
    },
    performance: view.performance ? toPerformanceResponse(view.performance) : null,
    model: view.model,
    positions: view.positions.map((position) => ({
      symbol: position.symbol,
      unitsMicro: str(position.unitsMicro),
      price: position.price
        ? { value: position.price.price, asOfDate: position.price.tradeDate, status: position.price.status }
        : null,
      valueCents: position.valueCents === null ? null : str(position.valueCents),
      targetWeightBps: position.targetWeightBps,
      actualWeightBps: position.actualWeightBps,
    })),
    openOrders: view.openOrders.map((order) => ({
      id: order.id,
      symbol: order.symbol,
      side: order.side,
      notionalCents: str(order.requestedNotionalCents),
      state: order.state,
    })),
  };
}

export async function loadActivity(services: CustomerServices, customerId: string): Promise<ActivityResponse> {
  const now = services.clock.now();
  const entries = await services.ledger.listForCustomer(customerId, { effectiveAt: now, publishedAt: now });
  const accountIds = [...new Set(entries.flatMap((entry) => entry.postings.map((posting) => posting.accountId)))];
  const paths = await services.accounts.pathsById(accountIds);
  const rows = buildActivityRows(entries, paths);
  return {
    rows: rows.map((row) => ({
      entryId: row.entryId,
      kind: row.kind,
      label: row.label,
      description: row.description,
      effectiveAt: iso(row.effectiveAt),
      postedAt: iso(row.postedAt),
      source: row.source,
      amount: { commodity: row.amount.commodity, quantity: str(row.amount.quantity) },
      legs: row.legs.map((leg) => ({ accountPath: leg.accountPath, commodity: leg.commodity, quantity: str(leg.quantity) })),
      reversesEntryId: row.reversesEntryId,
    })),
  };
}

export async function loadTransfers(services: CustomerServices, customerId: string): Promise<TransfersResponse> {
  const now = services.clock.now();
  const [bankAccounts, transfers, entries] = await Promise.all([
    services.bankAccounts.listForCustomer(customerId),
    services.transfers.listForCustomer(customerId),
    services.ledger.listForCustomer(customerId, { effectiveAt: now, publishedAt: now }),
  ]);
  const banks: BankAccountResponse[] = bankAccounts.map((bank) => ({
    id: bank.id,
    institutionName: bank.institutionName,
    accountMask: bank.accountMask,
    status: bank.status,
  }));
  const bankById = new Map(banks.map((bank) => [bank.id, bank]));
  return {
    bankAccounts: banks,
    transfers: transfers.map((transfer) => {
      const progress = buildDepositProgress(transfer, entries);
      return {
        id: transfer.id,
        direction: transfer.direction,
        amountCents: str(transfer.amountCents),
        status: progress.status,
        returnCode: progress.returnCode,
        createdAt: iso(transfer.createdAt),
        bankAccount: bankById.get(transfer.bankAccountId) ?? null,
        timeline: progress.timeline.map((step) => ({
          step: step.step,
          state: step.state,
          at: step.at ? iso(step.at) : null,
        })),
      };
    }),
  };
}
