import {
  type ActivityResponse,
  type CollectClosesRequest,
  type ConfirmationRequiredResponse,
  type CorrectedCloseRequest,
  type InvestmentResponse,
  type LateDividendRequest,
  type LinkTokenResponse,
  type LiveFireResponse,
  type MeResponse,
  type ModelsResponse,
  type OnboardingResponse,
  type PortfolioResponse,
  type RestatementsResponse,
  type RunValuationRequest,
  type SessionResponse,
  type StatementResponse,
  type StockSplitRequest,
  type TransfersResponse,
  type VerificationSessionResponse,
  activityResponse,
  apiError,
  confirmationRequiredResponse,
  investmentResponse,
  linkTokenResponse,
  liveFireResponse,
  meResponse,
  modelsResponse,
  onboardingResponse,
  portfolioResponse,
  restatementsResponse,
  sessionResponse,
  statementResponse,
  transfersResponse,
  verificationSessionResponse,
} from "@corgi/contracts";
import { type ZodType, z } from "zod";

// Two small write acknowledgements that only the web app consumes.
const linkedBankResponse = z.object({
  id: z.string(),
  institutionName: z.string(),
  accountMask: z.string(),
  status: z.string(),
});

const depositCreatedResponse = z.object({
  id: z.string(),
  providerTransferId: z.string(),
  status: z.literal("initiated"),
});

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Any non-2xx answer from the API, with the server's own error code preserved. */
export class ApiClientError extends Error {
  override readonly name = "ApiClientError";
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
  }

  /** Legs returned with a 409 `confirmation_required`, when present. */
  get confirmation(): ConfirmationRequiredResponse | null {
    const parsed = confirmationRequiredResponse.safeParse(this.body);
    return parsed.success ? parsed.data : null;
  }
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly token?: string | null;
  readonly fetch?: typeof fetch;
}

/**
 * Thin, typed wrapper over the customer API. Every response is validated
 * against `@corgi/contracts` at the boundary, so a drifting server shape fails
 * loudly here instead of rendering as a wrong number. The web app has no other
 * way to reach data.
 */
export function createApiClient(options: ApiClientOptions) {
  const fetchImpl = options.fetch ?? fetch;

  async function call<T>(method: "GET" | "POST", path: string, schema: ZodType<T>, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (options.token) headers.authorization = `Bearer ${options.token}`;

    let response: Response;
    try {
      const init: RequestInit = { method, headers, cache: "no-store" };
      if (body !== undefined) init.body = JSON.stringify(body);
      response = await fetchImpl(new URL(path, options.baseUrl), init);
    } catch (error) {
      throw new ApiClientError(0, "network_error", error instanceof Error ? error.message : "The API could not be reached");
    }

    const text = await response.text();
    const json: unknown = text ? safeJson(text) : null;
    if (!response.ok) {
      const parsed = apiError.safeParse(json);
      const code = parsed.success ? parsed.data.error : `http_${response.status}`;
      const message = parsed.success && parsed.data.message ? parsed.data.message : `The API answered ${response.status}`;
      throw new ApiClientError(response.status, code, message, json);
    }
    const result = schema.safeParse(json);
    if (!result.success) {
      throw new ApiClientError(response.status, "contract_mismatch", `Unexpected response shape from ${path}`, json);
    }
    return result.data;
  }

  return {
    signIn: (email: string, password: string): Promise<SessionResponse> =>
      call("POST", "/v1/auth/sign-in", sessionResponse, { email, password }),
    me: (): Promise<MeResponse> => call("GET", "/v1/customer/me", meResponse),
    onboarding: (): Promise<OnboardingResponse> => call("GET", "/v1/customer/onboarding", onboardingResponse),
    startVerification: (): Promise<VerificationSessionResponse> =>
      call("POST", "/v1/customer/verification", verificationSessionResponse),
    models: (): Promise<ModelsResponse> => call("GET", "/v1/customer/models", modelsResponse),
    portfolio: (): Promise<PortfolioResponse> => call("GET", "/v1/customer/portfolio", portfolioResponse),
    /** Figures as the customer saw them on `asPublishedOn` (YYYY-MM-DD); current when omitted. */
    statement: (asPublishedOn?: string | null): Promise<StatementResponse> =>
      call(
        "GET",
        asPublishedOn ? `/v1/customer/statement?asPublishedOn=${encodeURIComponent(asPublishedOn)}` : "/v1/customer/statement",
        statementResponse,
      ),
    chooseModel: (modelCode: string, confirmed: boolean): Promise<InvestmentResponse> =>
      call("POST", "/v1/customer/portfolio/model", investmentResponse, { modelCode, confirmed }),
    activity: (): Promise<ActivityResponse> => call("GET", "/v1/customer/activity", activityResponse),
    transfers: (): Promise<TransfersResponse> => call("GET", "/v1/customer/transfers", transfersResponse),
    createLinkToken: (): Promise<LinkTokenResponse> =>
      call("POST", "/v1/customer/bank-accounts/link-token", linkTokenResponse),
    linkBank: (input: { publicToken: string; accountId: string; institutionName: string; accountMask: string }) =>
      call("POST", "/v1/customer/bank-accounts", linkedBankResponse, input),
    createDeposit: (bankAccountId: string, amount: string) =>
      call("POST", "/v1/customer/transfers/deposits", depositCreatedResponse, { bankAccountId, amount }),

    // Operator surface. The bearer token here is the operator's LIVE_FIRE_TOKEN, never a customer session.
    restatements: (customerId?: string | null): Promise<RestatementsResponse> =>
      call("GET", customerId ? `/v1/ops/restatements?customerId=${encodeURIComponent(customerId)}` : "/v1/ops/restatements", restatementsResponse),
    correctedClose: (input: CorrectedCloseRequest): Promise<LiveFireResponse> =>
      call("POST", "/v1/ops/live-fire/corrected-close", liveFireResponse, input),
    lateDividend: (input: LateDividendRequest): Promise<LiveFireResponse> =>
      call("POST", "/v1/ops/live-fire/late-dividend", liveFireResponse, input),
    stockSplit: (input: StockSplitRequest): Promise<LiveFireResponse> =>
      call("POST", "/v1/ops/live-fire/stock-split", liveFireResponse, input),
    runValuation: (input: RunValuationRequest): Promise<LiveFireResponse> =>
      call("POST", "/v1/ops/live-fire/run-valuation", liveFireResponse, input),
    collectCloses: (input: CollectClosesRequest): Promise<LiveFireResponse> =>
      call("POST", "/v1/ops/live-fire/collect-closes", liveFireResponse, input),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
