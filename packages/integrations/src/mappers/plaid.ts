import type { TransferKind } from "@corgi/application";
import { z } from "zod";

const eventSchema = z.object({
  transfer_id: z.string(),
  event_type: z.string(),
  timestamp: z.string().optional(),
  failure_reason: z
    .object({ ach_return_code: z.string().nullish() })
    .nullish(),
});

/**
 * Normalizes a Plaid transfer event (from `/transfer/event/sync`) into the
 * ledger-relevant transition. Plaid events carry only the transfer id and type —
 * not the amount — so the caller looks the amount up from our own transfer
 * record. Non-material events (e.g. `transfer.created`) map to null.
 */
export interface PlaidTransferNotification {
  readonly transferId: string;
  readonly kind: TransferKind;
  readonly occurredAt: Date;
  readonly returnCode?: string;
}

export function parsePlaidTransferEvent(payload: unknown): PlaidTransferNotification | null {
  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success) return null;
  const { transfer_id, event_type, timestamp } = parsed.data;

  let kind: TransferKind;
  switch (event_type) {
    case "pending":
      kind = "pending";
      break;
    case "posted":
    case "settled":
      kind = "settled";
      break;
    case "returned":
    case "failed":
      kind = "returned";
      break;
    default:
      return null;
  }

  const returnCode = parsed.data.failure_reason?.ach_return_code ?? undefined;
  return {
    transferId: transfer_id,
    kind,
    occurredAt: timestamp ? new Date(timestamp) : new Date(),
    ...(returnCode ? { returnCode } : {}),
  };
}
