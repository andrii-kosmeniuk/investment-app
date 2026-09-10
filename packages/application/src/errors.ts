/** The customer is not permitted to trade (KYC not approved or trading blocked). */
export class OrderNotPermittedError extends Error {
  override readonly name = "OrderNotPermittedError";
}

/** The order would exceed the customer's available-to-trade balance. */
export class InsufficientFundsError extends Error {
  override readonly name = "InsufficientFundsError";
}

/** The caller asked for something that does not exist or is not theirs. */
export class NotFoundError extends Error {
  override readonly name = "NotFoundError";
}

/** The input is well-formed but violates a business rule (amount, state). */
export class ValidationError extends Error {
  override readonly name = "ValidationError";
}

/** At least one order needs the customer's explicit confirmation before it is placed. */
export class ConfirmationRequiredError extends Error {
  override readonly name = "ConfirmationRequiredError";
  constructor(
    message: string,
    readonly legs: readonly { symbol: string; notionalCents: bigint }[],
  ) {
    super(message);
  }
}

/** The customer's current state forbids the action (e.g. KYC not approved). */
export class NotPermittedError extends Error {
  override readonly name = "NotPermittedError";
}

/**
 * The funding provider refused to authorise the debit (insufficient funds,
 * risk rule, closed account). Nothing was created; the customer must be told
 * the provider's reason, not "something went wrong".
 */
export class DepositDeclinedError extends Error {
  override readonly name = "DepositDeclinedError";
  constructor(
    /** Provider rationale code, e.g. `NSF`, `RISK`, `MANUALLY_VERIFIED_ITEM`. */
    readonly code: string,
    readonly description: string,
  ) {
    super(`The bank declined the transfer: ${description}`);
  }
}
