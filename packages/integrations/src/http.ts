export interface HttpClientOptions {
  readonly baseUrl: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export class ProviderHttpError extends Error {
  override readonly name = "ProviderHttpError";
  constructor(
    readonly provider: string,
    readonly status: number,
    readonly responseBody: string,
  ) {
    super(`${provider} returned HTTP ${status}`);
  }
}

export function createProviderClient(provider: string, options: HttpClientOptions) {
  return async function request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
    const response = await fetch(new URL(path, options.baseUrl), {
      ...init,
      signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...options.headers,
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new ProviderHttpError(provider, response.status, await response.text());
    }
    return (await response.json()) as T;
  };
}
