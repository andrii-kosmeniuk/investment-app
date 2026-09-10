/** The customer is not permitted to trade (KYC not approved or trading blocked). */
export class OrderNotPermittedError extends Error {
  override readonly name = "OrderNotPermittedError";
}

/** The order would exceed the customer's available-to-trade balance. */
export class InsufficientFundsError extends Error {
  override readonly name = "InsufficientFundsError";
}
