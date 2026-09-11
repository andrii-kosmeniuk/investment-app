import type { ActorType, AgingBucket, ApprovalKind, ApprovalStatus, ReconBreakStatus, ReconCategory } from "@corgi/contracts";
import type { StatusTone } from "@corgi/ui";

/** Operator-facing wording for the operations console (ADR-0005). */

const APPROVAL_KIND: Readonly<Record<ApprovalKind, string>> = {
  withdrawal: "Withdrawal",
  order: "Order",
  rebalance: "Rebalance",
  recon_adjustment: "Ledger adjustment",
};
export const approvalKindLabel = (kind: ApprovalKind): string => APPROVAL_KIND[kind] ?? kind;

const APPROVAL_STATUS: Readonly<Record<ApprovalStatus, StatusTone>> = {
  pending: "warning",
  approved: "positive",
  rejected: "negative",
  cancelled: "neutral",
};
export const approvalStatusTone = (status: ApprovalStatus): StatusTone => APPROVAL_STATUS[status] ?? "neutral";

const RECON_CATEGORY: Readonly<Record<ReconCategory, string>> = {
  position_units: "Position",
  cash: "Cash",
  missing_transaction: "Missing at custodian",
  unexpected_transaction: "Unexpected at custodian",
  price: "Price",
};
export const reconCategoryLabel = (category: ReconCategory): string => RECON_CATEGORY[category] ?? category;

const BREAK_STATUS: Readonly<Record<ReconBreakStatus, StatusTone>> = {
  open: "warning",
  explained: "info",
  resolved: "positive",
};
export const breakStatusTone = (status: ReconBreakStatus): StatusTone => BREAK_STATUS[status] ?? "neutral";

const AGING: Readonly<Record<AgingBucket, StatusTone>> = {
  "0-1d": "info",
  "2-3d": "warning",
  "4d+": "negative",
};
export const agingTone = (bucket: AgingBucket): StatusTone => AGING[bucket] ?? "neutral";

export const AGING_ORDER: readonly AgingBucket[] = ["0-1d", "2-3d", "4d+"];

/** How a break's three columns read: cents, micro-units, or present/absent for transactions. */
export function breakFigure(category: ReconCategory, raw: string): string {
  if (category === "cash") return dollarsFromCents(raw);
  if (category === "missing_transaction" || category === "unexpected_transaction") return raw === "0" ? "absent" : "present";
  return unitsFromMicro(raw);
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
function dollarsFromCents(raw: string): string {
  const value = BigInt(raw);
  const formatted = usd.format(Number(value < 0n ? -value : value) / 100);
  return value < 0n ? `−${formatted}` : formatted;
}
function unitsFromMicro(raw: string): string {
  const value = BigInt(raw);
  const sign = value < 0n ? "−" : "";
  const abs = value < 0n ? -value : value;
  return `${sign}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, "0")}`;
}

export const shortId = (id: string): string => `${id.slice(0, 8)}…`;

/** Who filed it, at a glance: the checker must know when the requester was software. */
export const actorTag = (actorType: ActorType, role?: string): { label: string; tone: StatusTone } =>
  actorType === "agent" ? (role === "system" ? { label: "System", tone: "neutral" } : { label: "Agent", tone: "info" }) : { label: "Human", tone: "positive" };
