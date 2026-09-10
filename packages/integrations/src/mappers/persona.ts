import type { InquiryEvent } from "@corgi/application";
import { z } from "zod";

const inquirySchema = z.object({
  data: z.object({
    attributes: z.object({
      name: z.string().optional(),
      payload: z.object({
        data: z.object({
          attributes: z.object({
            status: z.string(),
            "reference-id": z.string().nullish(),
          }),
        }),
      }),
    }),
  }),
});

/**
 * Normalizes a Persona `inquiry.*` webhook into a KYC transition keyed by our
 * customer id (Persona's `reference-id`). Unknown statuses collapse to `pending`
 * so the funding gate stays closed until an explicit approval. Returns null when
 * the payload carries no reference id we can attribute to a customer.
 */
export function parsePersonaInquiryEvent(payload: unknown): InquiryEvent | null {
  const parsed = inquirySchema.safeParse(payload);
  if (!parsed.success) return null;
  const inquiry = parsed.data.data.attributes.payload.data.attributes;
  const customerId = inquiry["reference-id"];
  if (!customerId) return null;

  const raw = inquiry.status.replace("-", "_");
  const status: InquiryEvent["status"] =
    raw === "approved" || raw === "declined" || raw === "needs_review" ? raw : "pending";

  return { customerId, status, occurredAt: new Date() };
}
