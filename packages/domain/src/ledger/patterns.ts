import type { Posting } from "./index.js";

export interface CustomerLedgerAccounts {
  readonly settledCash: string;
  readonly pendingDeposit: string;
  readonly unsettledBuys: string;
  readonly unsettledSells: string;
  readonly dividendReceivable: string;
  readonly bounceRecovery: string;
  readonly dividendIncome: string;
  readonly feeExpense: string;
  position(symbol: string): string;
}

export interface ClearingAccounts {
  readonly plaidSweep: string;
  readonly tradingUsd: string;
  readonly rounding: string;
  tradingUnits(symbol: string): string;
  custodianStreet(symbol: string): string;
}

export const postingPatterns = {
  depositPending(
    customer: CustomerLedgerAccounts,
    clearing: ClearingAccounts,
    amountCents: bigint,
  ): readonly Posting[] {
    return [
      { accountId: customer.pendingDeposit, commodity: "USD", quantity: amountCents },
      { accountId: clearing.plaidSweep, commodity: "USD", quantity: -amountCents },
    ];
  },

  depositSettled(
    customer: CustomerLedgerAccounts,
    amountCents: bigint,
  ): readonly Posting[] {
    return [
      { accountId: customer.settledCash, commodity: "USD", quantity: amountCents },
      { accountId: customer.pendingDeposit, commodity: "USD", quantity: -amountCents },
    ];
  },

  buyFill(
    customer: CustomerLedgerAccounts,
    clearing: ClearingAccounts,
    symbol: string,
    unitsMicro: bigint,
    costCents: bigint,
    lotId: string,
  ): readonly Posting[] {
    return [
      {
        accountId: customer.position(symbol),
        commodity: symbol,
        quantity: unitsMicro,
        lotId,
      },
      {
        accountId: clearing.tradingUnits(symbol),
        commodity: symbol,
        quantity: -unitsMicro,
      },
      { accountId: customer.unsettledBuys, commodity: "USD", quantity: -costCents },
      { accountId: clearing.tradingUsd, commodity: "USD", quantity: costCents },
    ];
  },

  settleBuy(
    customer: CustomerLedgerAccounts,
    costCents: bigint,
  ): readonly Posting[] {
    return [
      { accountId: customer.unsettledBuys, commodity: "USD", quantity: costCents },
      { accountId: customer.settledCash, commodity: "USD", quantity: -costCents },
    ];
  },

  /** Units leave the position; proceeds wait in unsettled sells until T+1. */
  sellFill(
    customer: CustomerLedgerAccounts,
    clearing: ClearingAccounts,
    symbol: string,
    unitsMicro: bigint,
    proceedsCents: bigint,
  ): readonly Posting[] {
    return [
      { accountId: customer.position(symbol), commodity: symbol, quantity: -unitsMicro },
      { accountId: clearing.tradingUnits(symbol), commodity: symbol, quantity: unitsMicro },
      { accountId: customer.unsettledSells, commodity: "USD", quantity: proceedsCents },
      { accountId: clearing.tradingUsd, commodity: "USD", quantity: -proceedsCents },
    ];
  },

  settleSell(
    customer: CustomerLedgerAccounts,
    proceedsCents: bigint,
  ): readonly Posting[] {
    return [
      { accountId: customer.settledCash, commodity: "USD", quantity: proceedsCents },
      { accountId: customer.unsettledSells, commodity: "USD", quantity: -proceedsCents },
    ];
  },

  /**
   * Reconciliation adjustment: moves the custodian-confirmed difference in
   * units onto the customer's position against the street-name account.
   * `deltaUnitsMicro` is custodian − ledger, so a positive delta adds units.
   */
  positionAdjustment(
    customer: CustomerLedgerAccounts,
    clearing: ClearingAccounts,
    symbol: string,
    deltaUnitsMicro: bigint,
  ): readonly Posting[] {
    return [
      { accountId: customer.position(symbol), commodity: symbol, quantity: deltaUnitsMicro },
      { accountId: clearing.custodianStreet(symbol), commodity: symbol, quantity: -deltaUnitsMicro },
    ];
  },

  /** Reconciliation adjustment on settled cash against the firm rounding account. */
  cashAdjustment(
    customer: CustomerLedgerAccounts,
    clearing: ClearingAccounts,
    deltaCents: bigint,
  ): readonly Posting[] {
    return [
      { accountId: customer.settledCash, commodity: "USD", quantity: deltaCents },
      { accountId: clearing.rounding, commodity: "USD", quantity: -deltaCents },
    ];
  },

  /**
   * Closes the bounce receivable once the customer's cash is whole again
   * (sell-to-cover settled). The bank never delivered the deposit, so the
   * sweep claim opened by `depositPending` is cancelled against it.
   */
  bounceRecovered(
    customer: CustomerLedgerAccounts,
    clearing: ClearingAccounts,
    amountCents: bigint,
  ): readonly Posting[] {
    return [
      { accountId: customer.bounceRecovery, commodity: "USD", quantity: -amountCents },
      { accountId: clearing.plaidSweep, commodity: "USD", quantity: amountCents },
    ];
  },

  dividendEntitlement(
    customer: CustomerLedgerAccounts,
    amountCents: bigint,
  ): readonly Posting[] {
    return [
      { accountId: customer.dividendReceivable, commodity: "USD", quantity: amountCents },
      { accountId: customer.dividendIncome, commodity: "USD", quantity: -amountCents },
    ];
  },

  dividendPaid(
    customer: CustomerLedgerAccounts,
    amountCents: bigint,
  ): readonly Posting[] {
    return [
      { accountId: customer.settledCash, commodity: "USD", quantity: amountCents },
      { accountId: customer.dividendReceivable, commodity: "USD", quantity: -amountCents },
    ];
  },

  split(
    customer: CustomerLedgerAccounts,
    clearing: ClearingAccounts,
    symbol: string,
    additionalUnitsMicro: bigint,
  ): readonly Posting[] {
    return [
      {
        accountId: customer.position(symbol),
        commodity: symbol,
        quantity: additionalUnitsMicro,
      },
      {
        accountId: clearing.custodianStreet(symbol),
        commodity: symbol,
        quantity: -additionalUnitsMicro,
      },
    ];
  },

  depositReturnedAfterInvestment(
    customer: CustomerLedgerAccounts,
    amountCents: bigint,
  ): readonly Posting[] {
    return [
      { accountId: customer.settledCash, commodity: "USD", quantity: -amountCents },
      { accountId: customer.bounceRecovery, commodity: "USD", quantity: amountCents },
    ];
  },

  fee(customer: CustomerLedgerAccounts, feeCents: bigint): readonly Posting[] {
    return [
      { accountId: customer.feeExpense, commodity: "USD", quantity: feeCents },
      { accountId: customer.settledCash, commodity: "USD", quantity: -feeCents },
    ];
  },

  withdrawal(
    customer: CustomerLedgerAccounts,
    clearing: ClearingAccounts,
    amountCents: bigint,
  ): readonly Posting[] {
    return [
      { accountId: customer.settledCash, commodity: "USD", quantity: -amountCents },
      { accountId: clearing.plaidSweep, commodity: "USD", quantity: amountCents },
    ];
  },
} as const;

export function reversePostings(postings: readonly Posting[]): readonly Posting[] {
  return postings.map((posting) => ({ ...posting, quantity: -posting.quantity }));
}
