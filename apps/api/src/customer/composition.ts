import type { ApprovalRepository } from "@corgi/application";
import type { ApprovalRequest } from "@corgi/domain";
import {
  DrizzleAccountResolver,
  DrizzleBankAccountRepository,
  DrizzleCredentialsRepository,
  DrizzleCustomerDirectory,
  DrizzleCustomerRepository,
  DrizzleIdentityInquiryRepository,
  DrizzleLedgerAccountDirectory,
  DrizzleLedgerRepository,
  DrizzleModelCatalog,
  DrizzleOrderListing,
  DrizzleOrderRepository,
  DrizzlePortfolioAssignmentRepository,
  DrizzlePriceRepository,
  DrizzleTransferRepository,
  type TransactionalDatabase,
  approvalRequests,
} from "@corgi/database";
import { AlpacaBrokerAdapter, PersonaIdentityAdapter, PlaidFundingAdapter } from "@corgi/integrations";
import { eq } from "drizzle-orm";
import { createSessionTokens } from "../auth/session.js";
import type { ApiConfig } from "../config.js";
import type { CustomerServices } from "./services.js";

/** Approval requests filed by customers whose orders cross the confirmation threshold. */
class DrizzleApprovalRepository implements ApprovalRepository {
  constructor(private readonly db: TransactionalDatabase) {}

  async create(request: ApprovalRequest): Promise<void> {
    await this.db.insert(approvalRequests).values({
      id: request.id,
      kind: request.kind,
      amountCents: request.amountCents,
      payload: request.payload,
      requestedByActorId: request.requestedByActorId,
      requestedByActorType: request.requestedByActorType,
      status: request.status,
    });
  }

  async listPending(): Promise<readonly ApprovalRequest[]> {
    const rows = await this.db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.status, "pending"));
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as ApprovalRequest["kind"],
      amountCents: row.amountCents,
      payload: (row.payload ?? {}) as Readonly<Record<string, unknown>>,
      requestedByActorId: row.requestedByActorId,
      requestedByActorType: row.requestedByActorType,
      status: row.status,
    }));
  }
}

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
    models: new DrizzleModelCatalog(db),
    portfolios: new DrizzlePortfolioAssignmentRepository(db),
    orders: new DrizzleOrderRepository(db),
    orderListing: new DrizzleOrderListing(db),
    approvals: new DrizzleApprovalRepository(db),
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
          })
        : null,
  };
}
