import { allocateLargestRemainder } from "@corgi/domain";
import { ConfirmationRequiredError, NotFoundError, NotPermittedError } from "../errors.js";
import type { ModelCatalog, PortfolioAssignmentRepository } from "../ports.js";
import { type PlaceOrderDeps, placeOrder } from "./place-order.js";

export interface ChooseModelDeps extends PlaceOrderDeps {
  readonly models: ModelCatalog;
  readonly portfolios: PortfolioAssignmentRepository;
}

export interface ChooseModelCommand {
  readonly customerId: string;
  readonly modelCode: string;
  readonly requestedByActorId: string;
  /** Set once the customer has reviewed the legs in the confirmation sheet. */
  readonly confirmed: boolean;
}

export interface InvestmentLeg {
  readonly symbol: string;
  readonly notionalCents: bigint;
  readonly status: "submitted";
}

export interface ChooseModelResult {
  readonly modelCode: string;
  readonly legs: readonly InvestmentLeg[];
}

/**
 * Assigns a model and invests the available cash into it. The broker account
 * is opened lazily on first selection. Cash is split with the largest-remainder
 * method after the model's buffer, so the legs reconcile to the cent; legs below
 * a symbol's minimum are skipped. If any leg reaches the confirmation threshold
 * the whole plan is returned for explicit customer confirmation first; every
 * leg then goes through `placeOrder` so the KYC and funds gates apply per order.
 */
export async function chooseModel(
  deps: ChooseModelDeps,
  command: ChooseModelCommand,
): Promise<ChooseModelResult> {
  const customer = await deps.customers.findById(command.customerId);
  if (!customer) throw new NotFoundError(`unknown customer: ${command.customerId}`);
  if (customer.kycStatus !== "approved" || customer.tradingBlocked) {
    throw new NotPermittedError("Customer is not permitted to invest");
  }
  const model = await deps.models.findByCode(command.modelCode);
  if (!model) throw new NotFoundError(`unknown model: ${command.modelCode}`);

  const existing = await deps.portfolios.findForCustomer(command.customerId);
  const { accountId: brokerAccountId } = await deps.broker.ensureAccount(
    command.customerId,
    existing?.brokerAccountId,
  );
  await deps.portfolios.assign({
    customerId: command.customerId,
    modelId: model.id,
    brokerAccountId,
    status: "open",
  });

  const available = await deps.getAvailableToTradeCents(command.customerId);
  const investable = available > 0n ? (available * BigInt(10_000 - model.cashBufferBps)) / 10_000n : 0n;
  if (investable <= 0n) return { modelCode: model.code, legs: [] };

  const allocations = allocateLargestRemainder(
    investable,
    model.allocations.map((allocation) => ({
      key: allocation.symbol,
      weight: BigInt(allocation.targetWeightBps),
    })),
  );

  const planned = model.allocations
    .map((allocation) => ({ symbol: allocation.symbol, notionalCents: allocations.get(allocation.symbol) ?? 0n, minimum: allocation.minimumTradeCents }))
    .filter((leg) => leg.notionalCents > 0n && leg.notionalCents >= leg.minimum)
    .map(({ symbol, notionalCents }) => ({ symbol, notionalCents }));

  const needsConfirmation = planned.some((leg) => leg.notionalCents >= deps.confirmationThresholdCents);
  if (needsConfirmation && !command.confirmed) {
    throw new ConfirmationRequiredError("An order at or above the confirmation threshold needs your confirmation", planned);
  }

  const legs: InvestmentLeg[] = [];
  for (const leg of planned) {
    const placed = await placeOrder(deps, {
      customerId: command.customerId,
      symbol: leg.symbol,
      notionalCents: leg.notionalCents,
      side: "buy",
      requestedByActorId: command.requestedByActorId,
      customerConfirmed: command.confirmed,
    });
    if (placed.status !== "submitted") {
      throw new Error(`unexpected order routing for a confirmed customer order: ${placed.status}`);
    }
    legs.push({ symbol: leg.symbol, notionalCents: leg.notionalCents, status: "submitted" });
  }
  return { modelCode: model.code, legs };
}
