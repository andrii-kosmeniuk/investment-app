import {
  type CustomerProfile,
  NotFoundError,
  buildActivityRows,
  buildDepositProgress,
  buildOnboardingView,
  buildPortfolioView,
  deriveCustomerBalances,
} from "@corgi/application";
import type {
  ActivityResponse,
  BankAccountResponse,
  CustomerSummary,
  ModelResponse,
  OnboardingResponse,
  PortfolioResponse,
  TransfersResponse,
} from "@corgi/contracts";
import type { CustomerServices } from "./services.js";

const str = (value: bigint): string => value.toString();
const iso = (value: Date): string => value.toISOString();

/** The business date in the market's timezone, so a late-night read still says "today". */
export function businessDate(now: Date, timeZone = "America/New_York"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
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
  const prices = await services.prices.latestCloses([...balances.positionsMicro.keys()], asOf);

  const view = buildPortfolioView({ customerId, asOf, publishedAt: now, balances, prices, model, openOrders });
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
    return: view.return,
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
