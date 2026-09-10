import { z } from "zod";

/** Financial integers cross JSON boundaries as canonical decimal strings. */
export const integerString = z.string().regex(/^-?(0|[1-9]\d*)$/);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const isoTimestamp = z.string().datetime({ offset: true });

export const portfolioResponse = z.object({
  customerId: z.string().uuid(),
  asOf: isoDate,
  publishedAt: isoTimestamp,
  valueCents: integerString,
  settledCashCents: integerString,
  availableCashCents: integerString,
  withdrawableCashCents: integerString,
  pendingCashCents: integerString,
  twr: z.number(),
  priorPublishedTwr: z.number().nullable(),
  positions: z.array(
    z.object({
      symbol: z.string().min(1).max(12),
      unitsMicro: integerString,
      price: z.string(),
      valueCents: integerString,
      priceStatus: z.enum(["final", "stale", "missing"]),
      priceDate: isoDate,
    }),
  ),
});

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

export type PortfolioResponse = z.infer<typeof portfolioResponse>;
export type ApprovalResponse = z.infer<typeof approvalResponse>;
export type ReconciliationBreakResponse = z.infer<typeof reconciliationBreakResponse>;
