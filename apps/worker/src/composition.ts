import {
  type AccountResolver,
  type ActorDirectory,
  type ApprovalRepository,
  type Clock,
  type CustomerRepository,
  type IdGenerator,
  type InboxHandler,
  type LedgerAccountDirectory,
  type LedgerRepository,
  type OrderRepository,
  type PriceRepository,
  type SettlementRepository,
  type TaxLotRepository,
  applyFill,
  applyInquiryStatus,
  handleDepositReturn,
  recordTransferEvent,
} from "@corgi/application";
import {
  parseAlpacaFillEvent,
  parsePersonaInquiryEvent,
  parsePlaidTransferEvent,
} from "@corgi/integrations";

/**
 * Canonical inbox event types. Provider payloads are normalized to these at the
 * ingestion boundary (SSE consumer, Plaid sync, Persona webhook) so the
 * processor's handler map stays small and provider-agnostic.
 */
export const InboxEventType = {
  TradeFill: "trade.fill",
  TradePartialFill: "trade.partial_fill",
  TransferPending: "transfer.pending",
  TransferSettled: "transfer.settled",
  TransferReturned: "transfer.returned",
  KycUpdated: "kyc.updated",
} as const;

export interface TransferLookup {
  findByProviderId(
    providerTransferId: string,
  ): Promise<{ customerId: string; amountCents: bigint } | null>;
}

export interface HandlerDeps {
  readonly ledger: LedgerRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly resolver: AccountResolver;
  readonly orders: OrderRepository;
  readonly taxLots: TaxLotRepository;
  readonly transfers: TransferLookup;
  readonly customers: CustomerRepository;
  /** Fills also open the T+1 settlement row the 00:05 job later closes. */
  readonly settlements: SettlementRepository;
  /** A bounced deposit after investing blocks trading and files a sell-to-cover approval. */
  readonly approvals: ApprovalRepository;
  readonly actors: ActorDirectory;
  readonly accounts: LedgerAccountDirectory;
  readonly prices: PriceRepository;
}

/**
 * Wires normalized inbox events to application use-cases. Handlers are the only
 * place provider payload shapes meet the domain: each parses its payload with a
 * pure mapper, then delegates to an idempotent use-case.
 */
export function buildProviderHandlers(deps: HandlerDeps): Map<string, InboxHandler> {
  const ledgerDeps = { ledger: deps.ledger, clock: deps.clock, ids: deps.ids };

  const fill: InboxHandler = async (event) => {
    const parsed = parseAlpacaFillEvent(event.payload);
    if (!parsed) throw new Error(`unparseable Alpaca fill: ${event.dedupeKey}`);
    await applyFill(
      { ...ledgerDeps, resolver: deps.resolver, orders: deps.orders, taxLots: deps.taxLots, settlements: deps.settlements },
      parsed,
    );
  };

  const transfer: InboxHandler = async (event) => {
    const note = parsePlaidTransferEvent(event.payload);
    if (!note) throw new Error(`unparseable Plaid transfer: ${event.dedupeKey}`);
    const record = await deps.transfers.findByProviderId(note.transferId);
    if (!record) throw new Error(`unknown transfer: ${note.transferId}`);
    const transferEvent = {
      customerId: record.customerId,
      transferId: note.transferId,
      kind: note.kind,
      amountCents: record.amountCents,
      occurredAt: note.occurredAt,
      ...(note.returnCode ? { returnCode: note.returnCode } : {}),
    };
    if (note.kind === "returned") {
      await handleDepositReturn({ ...ledgerDeps, ...deps }, transferEvent);
      return;
    }
    await recordTransferEvent({ ...ledgerDeps, resolver: deps.resolver }, transferEvent);
  };

  const kyc: InboxHandler = async (event) => {
    const inquiry = parsePersonaInquiryEvent(event.payload);
    if (!inquiry) throw new Error(`unattributable Persona inquiry: ${event.dedupeKey}`);
    await applyInquiryStatus({ customers: deps.customers }, inquiry);
  };

  return new Map<string, InboxHandler>([
    [InboxEventType.TradeFill, fill],
    [InboxEventType.TradePartialFill, fill],
    [InboxEventType.TransferPending, transfer],
    [InboxEventType.TransferSettled, transfer],
    [InboxEventType.TransferReturned, transfer],
    [InboxEventType.KycUpdated, kyc],
  ]);
}

/** Normalizes an Alpaca trade-update event type to a canonical inbox type, or null to drop it. */
export function canonicalAlpacaType(rawEvent: string): string | null {
  if (rawEvent === "fill") return InboxEventType.TradeFill;
  if (rawEvent === "partial_fill") return InboxEventType.TradePartialFill;
  return null;
}
