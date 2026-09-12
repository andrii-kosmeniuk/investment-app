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

/** Registration asked for an email that already belongs to a customer. */
export class EmailTakenError extends Error {
  override readonly name = "EmailTakenError";
}

/**
 * The customer already has orders the broker has not finished (queued,
 * submitted or partially filled). A second model choice would invest the same
 * cash twice, so it waits until those orders settle one way or the other.
 */
export class OrdersInFlightError extends Error {
  override readonly name = "OrdersInFlightError";
}

/**
 * The broker answered with a server-side failure (5xx) or did not answer at
 * all. Distinguished from a rejection (4xx): the order is valid, the rail is
 * down, so the order is queued and retried rather than failed (ADR-0007).
 */
export function isBrokerOutage(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") return status >= 500;
  // fetch() network failures and AbortSignal timeouts carry no status.
  return error.name === "TypeError" || error.name === "TimeoutError" || error.name === "AbortError";
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
