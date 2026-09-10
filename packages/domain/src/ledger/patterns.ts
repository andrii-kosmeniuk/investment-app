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
