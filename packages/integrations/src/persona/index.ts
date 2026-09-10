import { createHmac, timingSafeEqual } from "node:crypto";
import type { IdentityPort } from "@corgi/application";
import { createProviderClient } from "../http.js";

export function verifyPersonaWebhook(input: {
  rawBody: string;
  signatureHeader: string;
  secret: string;
  now?: Date;
  toleranceSeconds?: number;
}): boolean {
  const values = Object.fromEntries(
    input.signatureHeader.split(",").map((part) => part.trim().split("=", 2)),
  );
  const timestamp = values.t;
  const signature = values.v1;
  if (!timestamp || !signature) return false;
  const age = Math.abs((input.now ?? new Date()).getTime() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > (input.toleranceSeconds ?? 300)) return false;
  const expected = createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.rawBody}`)
    .digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(signature, "hex");
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export interface PersonaConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly templateId: string;
}

export class PersonaIdentityAdapter implements IdentityPort {
  readonly #request;
  constructor(private readonly config: PersonaConfig) {
    this.#request = createProviderClient("persona", {
      baseUrl: config.baseUrl,
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "Persona-Version": "2023-01-05",
      },
    });
  }

  async createInquiry(customerId: string): Promise<{
    inquiryId: string;
    sessionToken: string;
  }> {
    const response = await this.#request<{
      data: { id: string; attributes: { "session-token": string } };
    }>("/api/v1/inquiries", {
      method: "POST",
      body: JSON.stringify({
        data: {
          attributes: {
            "inquiry-template-id": this.config.templateId,
            "reference-id": customerId,
          },
        },
      }),
    });
    return {
      inquiryId: response.data.id,
      sessionToken: response.data.attributes["session-token"],
    };
  }

  async resumeInquiry(inquiryId: string): Promise<{ sessionToken: string }> {
    const response = await this.#request<{
      meta: { "session-token": string };
    }>(`/api/v1/inquiries/${inquiryId}/resume`, { method: "POST", body: "{}" });
    return { sessionToken: response.meta["session-token"] };
  }

  async getStatus(
    inquiryId: string,
  ): Promise<"pending" | "needs_review" | "approved" | "declined"> {
    const response = await this.#request<{
      data: { attributes: { status: string } };
    }>(`/api/v1/inquiries/${inquiryId}`);
    const status = response.data.attributes.status.replace("-", "_");
    if (
      status === "pending" ||
      status === "needs_review" ||
      status === "approved" ||
      status === "declined"
    ) {
      return status;
    }
    return "pending";
  }
}
