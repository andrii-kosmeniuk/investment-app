import {
  type BalanceCutoff,
  type CustomerLedgerAccounts,
  deriveBalances,
} from "@corgi/domain";
import type { LedgerRepository } from "../ports.js";

export interface CustomerBalances {
  /** Cash that has settled and is spendable. */
  readonly settledCents: bigint;
  /** ACH initiated but not yet settled; shown, never spendable. */
  readonly pendingDepositCents: bigint;
  /** Magnitude of buy cost awaiting T+1 settlement (a liability, so >= 0). */
  readonly unsettledBuysCents: bigint;
  /** Magnitude of sell proceeds awaiting T+1 settlement (>= 0). */
  readonly unsettledSellsCents: bigint;
  /** Settled − unsettled buys + unsettled sells. */
  readonly availableToTradeCents: bigint;
  /** Settled − unsettled buys. Unsettled sell proceeds are NOT withdrawable. */
  readonly withdrawableCents: bigint;
  /** Dividends accrued on ex-date but not yet paid; counted in value, not spendable. */
  readonly dividendReceivableCents: bigint;
  /** Position units per symbol (micro-units), read from position accounts only. */
  readonly positionsMicro: ReadonlyMap<string, bigint>;
}

export interface DeriveCustomerBalancesDeps {
  readonly ledger: LedgerRepository;
}

/**
 * Reconstructs a customer's balances purely from postings, honouring both
 * temporal axes: `effectiveAt` (economic) and `publishedAt` (knowledge). Asking
 * for a past `publishedAt` yields the books "as we knew them then" — the
 * foundation for as-published vs as-corrected statements.
 */
export async function deriveCustomerBalances(
  deps: DeriveCustomerBalancesDeps,
  customerId: string,
  accounts: CustomerLedgerAccounts,
  symbols: readonly string[],
  cutoff: BalanceCutoff,
): Promise<CustomerBalances> {
  const entries = await deps.ledger.listForCustomer(customerId, cutoff);
  const byAccount = deriveBalances(entries, cutoff);
  const usd = (accountId: string): bigint => byAccount.get(accountId)?.get("USD") ?? 0n;

  const settledCents = usd(accounts.settledCash);
  const pendingDepositCents = usd(accounts.pendingDeposit);
  // These accounts carry signed balances: buys sit negative and sells positive
  // during the T+1 window. Expose magnitudes, but compute from the signed sums.
  const signedBuys = usd(accounts.unsettledBuys);
  const signedSells = usd(accounts.unsettledSells);

  const positionsMicro = new Map<string, bigint>();
  for (const symbol of symbols) {
    const units = byAccount.get(accounts.position(symbol))?.get(symbol) ?? 0n;
    if (units !== 0n) positionsMicro.set(symbol, units);
  }

  return {
    settledCents,
    pendingDepositCents,
    unsettledBuysCents: -signedBuys,
    unsettledSellsCents: signedSells,
    availableToTradeCents: settledCents + signedBuys + signedSells,
    withdrawableCents: settledCents + signedBuys,
    dividendReceivableCents: usd(accounts.dividendReceivable),
    positionsMicro,
  };
}
