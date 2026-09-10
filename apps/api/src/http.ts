import {
  ConfirmationRequiredError,
  InsufficientFundsError,
  NotFoundError,
  NotPermittedError,
  OrderNotPermittedError,
  ValidationError,
} from "@corgi/application";
import { ProviderHttpError } from "@corgi/integrations";
import type { ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw new HttpError(400, "invalid_request", result.error.issues.map((issue) => issue.message).join("; "));
}

export function requireProvider<T>(provider: T | null, name: string): T {
  if (provider === null) throw new HttpError(503, `${name}_not_configured`, `${name} is not configured in this environment`);
  return provider;
}

/**
 * Application errors become HTTP statuses here and nowhere else. Provider
 * failures are reported as 502 with the provider named, so the UI can say
 * "Plaid didn't respond" rather than a generic error (design brief §15).
 */
export function toHttp(error: unknown): { statusCode: number; body: Record<string, unknown> } {
  if (error instanceof HttpError) return { statusCode: error.statusCode, body: { error: error.code, message: error.message } };
  if (error instanceof ConfirmationRequiredError) {
    return {
      statusCode: 409,
      body: {
        error: "confirmation_required",
        message: error.message,
        legs: error.legs.map((leg) => ({ symbol: leg.symbol, notionalCents: leg.notionalCents.toString() })),
      },
    };
  }
  if (error instanceof ValidationError) return { statusCode: 400, body: { error: "invalid_request", message: error.message } };
  if (error instanceof NotFoundError) return { statusCode: 404, body: { error: "not_found", message: error.message } };
  if (error instanceof NotPermittedError || error instanceof OrderNotPermittedError) {
    return { statusCode: 403, body: { error: "not_permitted", message: error.message } };
  }
  if (error instanceof InsufficientFundsError) return { statusCode: 409, body: { error: "insufficient_funds", message: error.message } };
  if (error instanceof ProviderHttpError) {
    return { statusCode: 502, body: { error: "provider_unavailable", message: `${error.provider} returned HTTP ${error.status}` } };
  }
  return { statusCode: 500, body: { error: "internal_error", message: "Something went wrong on our side" } };
}
