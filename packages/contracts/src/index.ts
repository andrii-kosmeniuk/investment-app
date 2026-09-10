import { z } from "zod";

/** Financial integers cross JSON boundaries as canonical decimal strings. */
export const integerString = z.string().regex(/^-?(0|[1-9]\d*)$/);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const isoTimestamp = z.string().datetime({ offset: true });
/** A decimal amount typed by a human, e.g. "1000" or "1,000.50". Parsed server-side. */
export const decimalInput = z.string().trim().regex(/^\$?\d{1,3}(,?\d{3})*(\.\d{1,2})?$|^\$?\d+(\.\d{1,2})?$/);

export const kycStatus = z.enum(["not_started", "pending", "needs_review", "approved", "declined"]);
export const environmentName = z.enum(["sandbox", "production"]);

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

export const signInRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
});

export const customerSummary = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1),
  kycStatus,
  tradingBlocked: z.boolean(),
});

export const sessionResponse = z.object({
  token: z.string().min(1),
  expiresAt: isoTimestamp,
  customer: customerSummary,
});

export const meResponse = z.object({
  customer: customerSummary,
  environment: environmentName,
});

/* ------------------------------------------------------------------ */
/* Onboarding                                                          */
/* ------------------------------------------------------------------ */

export const onboardingStepKey = z.enum(["account", "identity", "bank", "deposit", "model"]);
export const onboardingStepStatus = z.enum(["complete", "current", "upcoming", "blocked"]);

export const onboardingResponse = z.object({
  customer: customerSummary,
  steps: z.array(
    z.object({
      key: onboardingStepKey,
      status: onboardingStepStatus,
      detail: z.string().nullable(),
    }),
  ),
  identity: z.object({
    status: kycStatus,
    inquiryId: z.string().nullable(),
    /** True when the customer may start or resume a verification session. */
    canStart: z.boolean(),
  }),
});

export const verificationSessionResponse = z.object({
  inquiryId: z.string().min(1),
  sessionToken: z.string().min(1),
});

/* ------------------------------------------------------------------ */
/* Models and portfolio                                                */
/* ------------------------------------------------------------------ */

export const modelResponse = z.object({
  id: z.string().uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  riskLevel: z.number().int().min(1).max(5),
  cashBufferBps: z.number().int().min(0).max(10000),
  allocations: z.array(
    z.object({
      symbol: z.string().min(1).max(12),
      targetWeightBps: z.number().int().min(0).max(10000),
    }),
  ),
});

export const modelsResponse = z.object({ models: z.array(modelResponse) });

export const priceStatus = z.enum(["final", "stale"]);

/* ------------------------------------------------------------------ */
/* Performance — versioned valuations and returns (ADR-0004)           */
/* ------------------------------------------------------------------ */

export const valuationStatus = z.enum(["final", "provisional"]);
export const returnPeriod = z.enum(["mtd", "ytd", "inception"]);

/** "Restated on <at> · was <previous>": present only when a visible earlier version showed a different number. */
const restatedNumber = z.object({ at: isoTimestamp, previous: z.number(), reason: z.string().nullable() }).nullable();
const restatedCents = z.object({ at: isoTimestamp, previous: integerString, reason: z.string().nullable() }).nullable();

export const periodReturnResponse = z.object({
  period: returnPeriod,
  periodStart: isoDate,
  periodEnd: isoDate,
  /** Time-weighted return as a fraction (0.0341 = +3.41%). */
  twr: z.number(),
  /** Modified Dietz (money-weighted) as a fraction; null when nothing was invested. */
  mwr: z.number().nullable(),
  flowsCents: integerString,
  version: z.number().int().positive(),
  restated: restatedNumber,
});

export const performanceResponse = z.object({
  asOfDate: isoDate,
  valueCents: integerString,
  status: valuationStatus,
  version: z.number().int().positive(),
  computedAt: isoTimestamp,
  restated: restatedCents,
  returns: z.array(periodReturnResponse),
});

export const valuationPointResponse = z.object({
  asOfDate: isoDate,
  valueCents: integerString,
  cashCents: integerString,
  status: valuationStatus,
  version: z.number().int().positive(),
  computedAt: isoTimestamp,
  reason: z.string().nullable(),
});

/** Statement view: the series and headline figures as known at a chosen publication date. */
export const statementResponse = z.object({
  /** The as-published date requested, or null for "current". */
  asPublishedOn: isoDate.nullable(),
  /** Knowledge cut-off actually applied. */
  publishedAt: isoTimestamp,
  performance: performanceResponse.nullable(),
  series: z.array(valuationPointResponse),
  /** Every superseding version of this customer's figures, newest first. */
  restatements: z.array(
    z.object({
      kind: z.enum(["valuation", "return"]),
      asOfDate: isoDate,
      period: returnPeriod.nullable(),
      version: z.number().int().positive(),
      computedAt: isoTimestamp,
      reason: z.string().nullable(),
      /** Decimal-string cents for valuations, fraction for returns — rendered per kind. */
      from: z.string(),
      to: z.string(),
    }),
  ),
});

export const portfolioResponse = z.object({
  customerId: z.string().uuid(),
  /** Business date the balances and prices refer to. */
  asOf: isoDate,
  /** Knowledge cut-off used to derive the view (bitemporal axis). */
  publishedAt: isoTimestamp,
  value: z.object({
    /** Null when any held position has no usable price. */
    cents: integerString.nullable(),
    status: z.enum(["final", "provisional", "unavailable"]),
  }),
  cash: z.object({
    settledCents: integerString,
    pendingDepositCents: integerString,
    unsettledBuysCents: integerString,
    unsettledSellsCents: integerString,
    availableToInvestCents: integerString,
    availableToWithdrawCents: integerString,
  }),
  /** Latest stored valuation and period returns; null until the first nightly run. */
  performance: performanceResponse.nullable(),
  model: z.object({ code: z.string().min(1), name: z.string().min(1) }).nullable(),
  positions: z.array(
    z.object({
      symbol: z.string().min(1).max(12),
      unitsMicro: integerString,
      price: z
        .object({ value: z.string().min(1), asOfDate: isoDate, status: priceStatus })
        .nullable(),
      valueCents: integerString.nullable(),
      targetWeightBps: z.number().int().nullable(),
      actualWeightBps: z.number().int().nullable(),
    }),
  ),
  openOrders: z.array(
    z.object({
      id: z.string().uuid(),
      symbol: z.string().min(1).max(12),
      side: z.enum(["buy", "sell"]),
      notionalCents: integerString,
      state: z.string().min(1),
    }),
  ),
});

export const chooseModelRequest = z.object({
  modelCode: z.string().min(1),
  /** True once the customer has reviewed the legs in the confirmation sheet. */
  confirmed: z.boolean().default(false),
});

export const investmentLeg = z.object({
  symbol: z.string().min(1).max(12),
  notionalCents: integerString,
});

export const investmentResponse = z.object({
  modelCode: z.string().min(1),
  legs: z.array(investmentLeg.extend({ status: z.literal("submitted") })),
});

/** 409 body when an order at/above the confirmation threshold needs the customer's explicit OK. */
export const confirmationRequiredResponse = z.object({
  error: z.literal("confirmation_required"),
  message: z.string(),
  legs: z.array(investmentLeg),
});

/* ------------------------------------------------------------------ */
/* Activity                                                            */
/* ------------------------------------------------------------------ */

export const activityRow = z.object({
  entryId: z.string().uuid(),
  kind: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  effectiveAt: isoTimestamp,
  postedAt: isoTimestamp,
  source: z.string().min(1),
  amount: z.object({ commodity: z.string().min(1), quantity: integerString }),
  legs: z.array(
    z.object({
      accountPath: z.string().min(1),
      commodity: z.string().min(1),
      quantity: integerString,
    }),
  ),
  reversesEntryId: z.string().uuid().nullable(),
});

export const activityResponse = z.object({ rows: z.array(activityRow) });

/* ------------------------------------------------------------------ */
/* Transfers                                                           */
/* ------------------------------------------------------------------ */

export const bankAccountResponse = z.object({
  id: z.string().uuid(),
  institutionName: z.string().min(1),
  accountMask: z.string().min(1),
  status: z.string().min(1),
});

export const depositStep = z.enum(["pending", "settled"]);
export const transferStatus = z.enum(["initiated", "pending", "settled", "returned"]);

export const transferResponse = z.object({
  id: z.string().uuid(),
  direction: z.enum(["deposit", "withdrawal"]),
  amountCents: integerString,
  status: transferStatus,
  returnCode: z.string().nullable(),
  createdAt: isoTimestamp,
  bankAccount: bankAccountResponse.nullable(),
  timeline: z.array(
    z.object({
      step: depositStep,
      state: z.enum(["done", "current", "upcoming", "failed"]),
      at: isoTimestamp.nullable(),
    }),
  ),
});

export const transfersResponse = z.object({
  bankAccounts: z.array(bankAccountResponse),
  transfers: z.array(transferResponse),
});

export const linkTokenResponse = z.object({ linkToken: z.string().min(1) });

export const linkBankRequest = z.object({
  publicToken: z.string().min(1),
  accountId: z.string().min(1),
  institutionName: z.string().min(1).max(120),
  accountMask: z.string().min(1).max(8),
});

export const createDepositRequest = z.object({
  bankAccountId: z.string().uuid(),
  amount: decimalInput,
});

export const apiError = z.object({
  error: z.string().min(1),
  message: z.string().optional(),
  requestId: z.string().optional(),
});

/* ------------------------------------------------------------------ */
/* Operations — live-fire console and restatement audit (ADR-0004)     */
/* ------------------------------------------------------------------ */

const decimalPrice = z.string().trim().regex(/^\d+(\.\d{1,8})?$/);
const positiveIntegerString = z.string().regex(/^[1-9]\d*$/);

export const correctedCloseRequest = z.object({
  symbol: z.string().min(1).max(12).toUpperCase(),
  tradeDate: isoDate,
  close: decimalPrice,
});

export const lateDividendRequest = z.object({
  customerId: z.string().uuid(),
  symbol: z.string().min(1).max(12).toUpperCase(),
  exDate: isoDate,
  payDate: isoDate,
  amountCents: positiveIntegerString,
});

export const stockSplitRequest = z.object({
  customerId: z.string().uuid(),
  symbol: z.string().min(1).max(12).toUpperCase(),
  numerator: positiveIntegerString,
  denominator: positiveIntegerString,
  effectiveDate: isoDate,
});

export const runValuationRequest = z.object({
  from: isoDate,
  to: isoDate,
  customerId: z.string().uuid().optional(),
});

export const collectClosesRequest = z.object({ from: isoDate, to: isoDate });

export const restatementSummary = z.object({
  customerId: z.string().uuid(),
  fromDate: isoDate,
  reason: z.string(),
  dates: z.array(isoDate),
  valuationsRewritten: z.number().int().nonnegative(),
  returnsRewritten: z.number().int().nonnegative(),
});

export const liveFireResponse = z.object({
  action: z.enum(["corrected_close", "late_dividend", "stock_split", "run_valuation", "collect_closes"]),
  summary: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  restatements: z.array(restatementSummary),
});

export const restatementAuditRow = z.object({
  kind: z.enum(["valuation", "return"]),
  customerId: z.string().uuid(),
  asOfDate: isoDate,
  period: returnPeriod.nullable(),
  version: z.number().int().positive(),
  computedAt: isoTimestamp,
  reason: z.string().nullable(),
  from: z.string(),
  to: z.string(),
});

export const restatementsResponse = z.object({ rows: z.array(restatementAuditRow) });

/* ------------------------------------------------------------------ */
/* Operations (unchanged from the earlier block)                       */
/* ------------------------------------------------------------------ */

export const approvalResponse = z.object({
  id: z.string().uuid(),
  kind: z.enum(["withdrawal", "order", "rebalance", "recon_adjustment"]),
  amountCents: integerString,
  requestedBy: z.object({
    id: z.string().uuid(),
    displayName: z.string(),
    actorType: z.enum(["human", "agent"]),
  }),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]),
  createdAt: isoTimestamp,
});

export const reconciliationBreakResponse = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid(),
  category: z.enum([
    "position_units",
    "cash",
    "missing_transaction",
    "unexpected_transaction",
    "price",
  ]),
  key: z.string(),
  ledgerValue: z.string(),
  custodianValue: z.string(),
  brokerValue: z.string().nullable(),
  delta: z.string(),
  ageDays: z.number().int().nonnegative(),
  status: z.enum(["open", "explained", "resolved"]),
});

export type KycStatus = z.infer<typeof kycStatus>;
export type SignInRequest = z.infer<typeof signInRequest>;
export type CustomerSummary = z.infer<typeof customerSummary>;
export type SessionResponse = z.infer<typeof sessionResponse>;
export type MeResponse = z.infer<typeof meResponse>;
export type OnboardingResponse = z.infer<typeof onboardingResponse>;
export type OnboardingStepKey = z.infer<typeof onboardingStepKey>;
export type VerificationSessionResponse = z.infer<typeof verificationSessionResponse>;
export type ModelResponse = z.infer<typeof modelResponse>;
export type ModelsResponse = z.infer<typeof modelsResponse>;
export type PortfolioResponse = z.infer<typeof portfolioResponse>;
export type PerformanceResponse = z.infer<typeof performanceResponse>;
export type PeriodReturnResponse = z.infer<typeof periodReturnResponse>;
export type ReturnPeriod = z.infer<typeof returnPeriod>;
export type StatementResponse = z.infer<typeof statementResponse>;
export type ValuationPointResponse = z.infer<typeof valuationPointResponse>;
export type LiveFireResponse = z.infer<typeof liveFireResponse>;
export type RestatementsResponse = z.infer<typeof restatementsResponse>;
export type RestatementAuditRow = z.infer<typeof restatementAuditRow>;
export type CorrectedCloseRequest = z.infer<typeof correctedCloseRequest>;
export type LateDividendRequest = z.infer<typeof lateDividendRequest>;
export type StockSplitRequest = z.infer<typeof stockSplitRequest>;
export type RunValuationRequest = z.infer<typeof runValuationRequest>;
export type CollectClosesRequest = z.infer<typeof collectClosesRequest>;
export type ChooseModelRequest = z.infer<typeof chooseModelRequest>;
export type InvestmentResponse = z.infer<typeof investmentResponse>;
export type ConfirmationRequiredResponse = z.infer<typeof confirmationRequiredResponse>;
export type ActivityRow = z.infer<typeof activityRow>;
export type ActivityResponse = z.infer<typeof activityResponse>;
export type BankAccountResponse = z.infer<typeof bankAccountResponse>;
export type TransferResponse = z.infer<typeof transferResponse>;
export type TransfersResponse = z.infer<typeof transfersResponse>;
export type LinkTokenResponse = z.infer<typeof linkTokenResponse>;
export type LinkBankRequest = z.infer<typeof linkBankRequest>;
export type CreateDepositRequest = z.infer<typeof createDepositRequest>;
export type ApiError = z.infer<typeof apiError>;
export type ApprovalResponse = z.infer<typeof approvalResponse>;
export type ReconciliationBreakResponse = z.infer<typeof reconciliationBreakResponse>;
