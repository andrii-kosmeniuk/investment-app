import {
  DrizzleAccountResolver,
  DrizzleActorDirectory,
  DrizzleApprovalRepository,
  DrizzleBankAccountRepository,
  DrizzleCredentialsRepository,
  DrizzleCustodianFileRepository,
  DrizzleCustomerDirectory,
  DrizzleCustomerRepository,
  DrizzleIdentityInquiryRepository,
  DrizzleInboundEventLog,
  DrizzleInboxRepository,
  DrizzleLedgerAccountDirectory,
  DrizzleLedgerRepository,
  DrizzleModelCatalog,
  DrizzleOrderListing,
  DrizzleOrderRepository,
  DrizzlePeriodReturnRepository,
  DrizzlePortfolioAssignmentRepository,
  DrizzlePriceRepository,
  DrizzleReconciliationRepository,
  DrizzleSettlementRepository,
  DrizzleTaxLotRepository,
  DrizzleTransferRepository,
  DrizzleValuationRepository,
  type TransactionalDatabase,
} from "@corgi/database";
import {
  AlpacaBrokerAdapter,
  AlpacaMarketDataAdapter,
  PersonaIdentityAdapter,
  PlaidFundingAdapter,
} from "@corgi/integrations";
import { createSessionTokens } from "../auth/session.js";
import type { ApiConfig } from "../config.js";
import type { CustomerServices } from "./services.js";

export function createCustomerServices(db: TransactionalDatabase, config: ApiConfig): CustomerServices {
  return {
    sessions: createSessionTokens({ secret: config.SESSION_SECRET, ttlSeconds: config.SESSION_TTL_HOURS * 3600 }),
    clock: { now: () => new Date() },
    ids: { next: () => crypto.randomUUID() },
    environment: config.ENVIRONMENT_NAME,
    limits: {
      orderConfirmationThresholdCents: config.ORDER_CONFIRMATION_THRESHOLD_CENTS,
      maximumDepositCents: config.MAXIMUM_DEPOSIT_CENTS,
    },
    directory: new DrizzleCustomerDirectory(db),
    credentials: new DrizzleCredentialsRepository(db),
    customers: new DrizzleCustomerRepository(db),
    inquiries: new DrizzleIdentityInquiryRepository(db),
    bankAccounts: new DrizzleBankAccountRepository(db),
    transfers: new DrizzleTransferRepository(db),
    ledger: new DrizzleLedgerRepository(db),
    resolver: new DrizzleAccountResolver(db),
    accounts: new DrizzleLedgerAccountDirectory(db),
    prices: new DrizzlePriceRepository(db),
    valuations: new DrizzleValuationRepository(db),
    returns: new DrizzlePeriodReturnRepository(db),
    taxLots: new DrizzleTaxLotRepository(db),
    models: new DrizzleModelCatalog(db),
    portfolios: new DrizzlePortfolioAssignmentRepository(db),
    orders: new DrizzleOrderRepository(db),
    orderListing: new DrizzleOrderListing(db),
    approvals: new DrizzleApprovalRepository(db),
    actors: new DrizzleActorDirectory(db),
    settlements: new DrizzleSettlementRepository(db),
    custodianFiles: new DrizzleCustodianFileRepository(db),
    reconciliation: new DrizzleReconciliationRepository(db),
    events: new DrizzleInboundEventLog(db),
    inbox: new DrizzleInboxRepository(db),
    identity:
      config.PERSONA_API_KEY && config.PERSONA_TEMPLATE_ID
        ? new PersonaIdentityAdapter({
            baseUrl: config.PERSONA_BASE_URL,
            apiKey: config.PERSONA_API_KEY,
            templateId: config.PERSONA_TEMPLATE_ID,
          })
        : null,
    funding:
      config.PLAID_CLIENT_ID && config.PLAID_SECRET
        ? new PlaidFundingAdapter({
            baseUrl: config.PLAID_BASE_URL,
            clientId: config.PLAID_CLIENT_ID,
            secret: config.PLAID_SECRET,
          })
        : null,
    broker:
      config.ALPACA_KEY && config.ALPACA_SECRET
        ? new AlpacaBrokerAdapter({
            baseUrl: config.ALPACA_BROKER_BASE_URL,
            key: config.ALPACA_KEY,
            secret: config.ALPACA_SECRET,
            sandboxAccountId: config.ALPACA_SANDBOX_ACCOUNT_ID,
          })
        : null,
    marketData:
      config.ALPACA_KEY && config.ALPACA_SECRET
        ? new AlpacaMarketDataAdapter({
            baseUrl: config.ALPACA_MARKET_DATA_BASE_URL,
            key: config.ALPACA_KEY,
            secret: config.ALPACA_SECRET,
          })
        : null,
    liveFireToken: config.LIVE_FIRE_TOKEN ?? null,
  };
}
