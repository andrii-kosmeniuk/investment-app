import type { JournalEntry } from "@corgi/domain";
import type { TransferRecord } from "../ports.js";

export type DepositStatus = "initiated" | "pending" | "settled" | "returned";

export interface DepositTimelineStep {
  readonly step: "pending" | "settled";
  readonly state: "done" | "current" | "upcoming" | "failed";
  readonly at: Date | null;
}

export interface DepositProgress {
  readonly status: DepositStatus;
  readonly returnCode: string | null;
  readonly timeline: readonly DepositTimelineStep[];
}

const RETURN_CODE = /\(([A-Z]\d{2})\)/;

/**
 * Reads a deposit's lifecycle off the ledger, not off the transfer row: each
 * Plaid state change was booked as an entry keyed by the transfer id, so the
 * timeline is exactly what the books say happened and when.
 */
export function buildDepositProgress(
  transfer: TransferRecord,
  entries: readonly JournalEntry[],
): DepositProgress {
  const own = entries.filter((entry) => entry.sourceRef === transfer.providerTransferId);
  const at = (kind: string): Date | null =>
    own.find((entry) => entry.kind === kind)?.effectiveAt ?? null;

  const pendingAt = at("deposit_pending");
  const settledAt = at("deposit_settled");
  const returned = own.find((entry) => entry.kind === "deposit_returned");

  const status: DepositStatus = returned
    ? "returned"
    : settledAt
      ? "settled"
      : pendingAt
        ? "pending"
        : "initiated";

  const returnCode =
    transfer.returnCode ?? (returned ? RETURN_CODE.exec(returned.description)?.[1] ?? null : null);

  return {
    status,
    returnCode,
    timeline: [
      {
        step: "pending",
        state: pendingAt ? "done" : "current",
        at: pendingAt ?? transfer.createdAt,
      },
      {
        step: "settled",
        state: returned ? "failed" : settledAt ? "done" : pendingAt ? "current" : "upcoming",
        at: returned ? returned.effectiveAt : settledAt,
      },
    ],
  };
}
