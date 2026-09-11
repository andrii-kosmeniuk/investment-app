import { type ApprovalRequest, type RebalanceLeg, businessDate, microUnits, parseDecimal, proposeRebalance, valuePosition } from "@corgi/domain";
import { InsufficientFundsError, NotFoundError, NotPermittedError, ValidationError } from "../errors.js";
import { deriveCustomerBalances } from "../ledger/balances.js";
import type {
  AccountResolver,
  ApprovalRepository,
  Clock,
  CustomerRepository,
  IdGenerator,
  LedgerAccountDirectory,
  LedgerRepository,
  ModelDefinition,
  PortfolioAssignmentRepository,
  PriceRepository,
} from "../ports.js";
import { fileApproval } from "./approvals.js";

export interface Requester {
  readonly id: string;
  readonly actorType: "human" | "agent";
}

/* ------------------------------------------------------------------ */
/* Withdrawal                                                           */
/* ------------------------------------------------------------------ */

export interface RequestWithdrawalDeps {
  readonly customers: CustomerRepository;
  readonly ledger: LedgerRepository;
  readonly resolver: AccountResolver;
  readonly approvals: ApprovalRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * Files a withdrawal for maker-checker. Checked against *withdrawable* cash
 * (settled − unsettled buys; unsettled sell proceeds do not count), so the
 * checker never sees a request the ledger cannot honour today.
 */
export async function requestWithdrawal(
  deps: RequestWithdrawalDeps,
  input: { customerId: string; amountCents: bigint; reason: string; requestedBy: Requester },
): Promise<ApprovalRequest> {
  if (input.amountCents <= 0n) throw new ValidationError("Withdrawal amount must be positive");
  const customer = await deps.customers.findById(input.customerId);
  if (!customer) throw new NotFoundError("Customer not found");
  if (customer.kycStatus !== "approved" || customer.tradingBlocked) {
    throw new NotPermittedError("Customer cannot withdraw right now");
  }

  const now = deps.clock.now();
  const accounts = await deps.resolver.forCustomer(input.customerId, []);
  const balances = await deriveCustomerBalances({ ledger: deps.ledger }, input.customerId, accounts, [], { effectiveAt: now, publishedAt: now });
  if (input.amountCents > balances.withdrawableCents) {
    throw new InsufficientFundsError(`Withdrawal of ${input.amountCents} exceeds withdrawable ${balances.withdrawableCents}`);
  }

  return fileApproval(deps, {
    kind: "withdrawal",
    amountCents: input.amountCents,
    payload: { customerId: input.customerId, reason: input.reason },
    requestedBy: input.requestedBy,
  });
}

/* ------------------------------------------------------------------ */
/* Rebalance proposal                                                   */
/* ------------------------------------------------------------------ */

export interface ProposeRebalanceDeps {
  readonly customers: CustomerRepository;
  readonly ledger: LedgerRepository;
  readonly resolver: AccountResolver;
  readonly accounts: LedgerAccountDirectory;
  readonly prices: PriceRepository;
  readonly portfolios: PortfolioAssignmentRepository;
  readonly models: { findById(id: string): Promise<ModelDefinition | null> };
  readonly approvals: ApprovalRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export type ProposeRebalanceResult =
  | { readonly status: "in_balance"; readonly asOfDate: string }
  | { readonly status: "filed"; readonly request: ApprovalRequest; readonly legs: readonly RebalanceLeg[]; readonly asOfDate: string };

const PRICE_SCALE = 8;

/**
 * Values the customer at the latest closes and computes drift legs against
 * their model (buffer, minimum trade, Hamilton cent). The legs are frozen into
 * the request payload: the checker approves exactly these trades. Used by the
 * console and by the MCP `propose_rebalance` tool alike (ADR-0005).
 */
export async function proposeRebalanceForCustomer(
  deps: ProposeRebalanceDeps,
  input: { customerId: string; reason: string; requestedBy: Requester },
): Promise<ProposeRebalanceResult> {
  const customer = await deps.customers.findById(input.customerId);
  if (!customer) throw new NotFoundError("Customer not found");
  if (customer.kycStatus !== "approved" || customer.tradingBlocked) {
    throw new NotPermittedError("Customer is not permitted to trade");
  }
  const assignment = await deps.portfolios.findForCustomer(input.customerId);
  const model = assignment ? await deps.models.findById(assignment.modelId) : null;
  if (!assignment || !model) throw new ValidationError("Customer has not chosen a model");

  const now = deps.clock.now();
  const asOfDate = businessDate(now);
  const held = await deps.accounts.positionSymbols(input.customerId);
  const symbols = [...new Set([...held, ...model.allocations.map((a) => a.symbol)])].sort();
  const accounts = await deps.resolver.forCustomer(input.customerId, symbols);
  const balances = await deriveCustomerBalances({ ledger: deps.ledger }, input.customerId, accounts, symbols, { effectiveAt: now, publishedAt: now });

  const heldSymbols = [...balances.positionsMicro.keys()];
  const closes = await deps.prices.latestCloses(heldSymbols, asOfDate);
  const missing = heldSymbols.filter((symbol) => !closes.has(symbol));
  if (missing.length > 0) throw new ValidationError(`No price for ${missing.join(", ")}; cannot value the portfolio`);

  const currentValues = new Map<string, bigint>();
  for (const [symbol, units] of balances.positionsMicro) {
    currentValues.set(symbol, valuePosition(microUnits(units), parseDecimal(closes.get(symbol)!.price, PRICE_SCALE)));
  }
  const portfolioValueCents = [...currentValues.values()].reduce((sum, value) => sum + value, balances.availableToTradeCents);

  const legs = proposeRebalance({
    portfolioValueCents,
    cashBufferBps: model.cashBufferBps,
    currentValues,
    targets: model.allocations.map((a) => ({
      symbol: a.symbol,
      weightBps: a.targetWeightBps,
      minimumTradeCents: a.minimumTradeCents,
      fractionalAllowed: a.fractionalAllowed,
    })),
  });
  if (legs.length === 0) return { status: "in_balance", asOfDate };

  const request = await fileApproval(deps, {
    kind: "rebalance",
    amountCents: legs.reduce((sum, leg) => sum + leg.notionalCents, 0n),
    payload: {
      customerId: input.customerId,
      reason: input.reason,
      asOfDate,
      legs: legs.map((leg) => ({ ...leg, notionalCents: leg.notionalCents.toString() })),
    },
    requestedBy: input.requestedBy,
  });
  return { status: "filed", request, legs, asOfDate };
}
