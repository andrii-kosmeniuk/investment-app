import type {
  AccountResolver,
  ApprovalRepository,
  BankAccountRepository,
  BrokerPort,
  Clock,
  CredentialsRepository,
  CustomerDirectory,
  CustomerRepository,
  FundingPort,
  IdGenerator,
  IdentityInquiryRepository,
  IdentityPort,
  LedgerAccountDirectory,
  LedgerRepository,
  MarketDataPort,
  ModelCatalog,
  ModelDefinition,
  OrderListing,
  OrderRepository,
  PeriodReturnRepository,
  PortfolioAssignmentRepository,
  PriceRepository,
  TaxLotRepository,
  TransferRepository,
  ValuationRepository,
} from "@corgi/application";
import type { SessionTokens } from "../auth/session.js";

/**
 * Everything the customer routes need, expressed as application ports so the
 * routes can be exercised against in-memory fakes. Providers are nullable: an
 * unconfigured rail makes its routes answer 503 instead of the API refusing to
 * boot (ADR-0002).
 */
export interface CustomerServices {
  readonly sessions: SessionTokens;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly environment: "sandbox" | "production";
  readonly limits: {
    readonly orderConfirmationThresholdCents: bigint;
    readonly maximumDepositCents: bigint;
  };
  readonly directory: CustomerDirectory;
  readonly credentials: CredentialsRepository;
  readonly customers: CustomerRepository;
  readonly inquiries: IdentityInquiryRepository;
  readonly bankAccounts: BankAccountRepository;
  readonly transfers: TransferRepository;
  readonly ledger: LedgerRepository;
  readonly resolver: AccountResolver;
  readonly accounts: LedgerAccountDirectory;
  readonly prices: PriceRepository;
  readonly valuations: ValuationRepository;
  readonly returns: PeriodReturnRepository;
  readonly taxLots: TaxLotRepository;
  readonly models: ModelCatalog & { findById(id: string): Promise<ModelDefinition | null> };
  readonly portfolios: PortfolioAssignmentRepository;
  readonly orders: OrderRepository;
  readonly orderListing: OrderListing;
  readonly approvals: ApprovalRepository;
  readonly identity: IdentityPort | null;
  readonly funding: FundingPort | null;
  readonly broker: BrokerPort | null;
  readonly marketData: MarketDataPort | null;
  /** Operator credential for `/v1/ops/*`; null disables those routes (503). */
  readonly liveFireToken: string | null;
}
