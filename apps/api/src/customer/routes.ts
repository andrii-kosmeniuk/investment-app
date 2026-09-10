import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { chooseModel, createDeposit, deriveCustomerBalances, linkBankAccount, signIn, startVerification } from "@corgi/application";
import { chooseModelRequest, createDepositRequest, isoDate, linkBankRequest, signInRequest } from "@corgi/contracts";
import { parseUsd } from "@corgi/domain";
import { bearerToken } from "../auth/session.js";
import { HttpError, parseBody, requireProvider, toHttp } from "../http.js";
import {
  loadActivity,
  loadModels,
  loadOnboarding,
  loadPortfolio,
  loadStatement,
  loadTransfers,
  requireProfile,
  toCustomerSummary,
} from "./read-models.js";
import type { CustomerServices } from "./services.js";

export async function registerCustomerRoutes(app: FastifyInstance, services: CustomerServices): Promise<void> {
  app.setErrorHandler((error, request, reply) => {
    const mapped = toHttp(error);
    if (mapped.statusCode >= 500) request.log.error({ err: error }, "customer route failed");
    return reply.code(mapped.statusCode).send({ ...mapped.body, requestId: request.id });
  });

  app.post("/auth/sign-in", async (request, reply) => {
    const body = parseBody(signInRequest, request.body);
    const profile = await signIn({ directory: services.directory, credentials: services.credentials }, body);
    if (!profile) return reply.code(401).send({ error: "invalid_credentials", message: "Email or password is incorrect" });
    const session = await services.sessions.issue({ customerId: profile.id }, services.clock.now());
    return reply.send({ token: session.token, expiresAt: session.expiresAt.toISOString(), customer: toCustomerSummary(profile) });
  });

  await app.register(async (authenticated) => {
    authenticated.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
      const token = bearerToken(request.headers.authorization);
      const claims = token ? await services.sessions.verify(token, services.clock.now()) : null;
      if (!claims) return reply.code(401).send({ error: "unauthorized", message: "Sign in to continue" });
      request.customerId = claims.customerId;
    });

    const customerOf = (request: FastifyRequest): string => {
      if (!request.customerId) throw new HttpError(401, "unauthorized", "Sign in to continue");
      return request.customerId;
    };

    authenticated.get("/customer/me", async (request) => {
      const profile = await requireProfile(services, customerOf(request));
      return { customer: toCustomerSummary(profile), environment: services.environment };
    });

    authenticated.get("/customer/onboarding", (request) => loadOnboarding(services, customerOf(request)));

    authenticated.post("/customer/verification", async (request, reply) => {
      const identity = requireProvider(services.identity, "persona");
      const session = await startVerification(
        { customers: services.customers, inquiries: services.inquiries, identity, clock: services.clock },
        customerOf(request),
      );
      return reply.code(201).send(session);
    });

    authenticated.get("/customer/models", async () => ({ models: await loadModels(services) }));

    authenticated.get("/customer/portfolio", (request) => loadPortfolio(services, customerOf(request)));

    // Statement with the "as published" toggle: `?asPublishedOn=YYYY-MM-DD` replays the figures
    // as they stood at the end of that business day; superseded versions stay reachable.
    authenticated.get("/customer/statement", (request) => {
      const query = request.query as { asPublishedOn?: string };
      const asPublishedOn = query.asPublishedOn ? parseBody(isoDate, query.asPublishedOn) : null;
      return loadStatement(services, customerOf(request), asPublishedOn);
    });

    authenticated.post("/customer/portfolio/model", async (request, reply) => {
      const body = parseBody(chooseModelRequest, request.body);
      const broker = requireProvider(services.broker, "alpaca");
      const customerId = customerOf(request);
      const result = await chooseModel(
        {
          customers: services.customers,
          orders: services.orders,
          broker,
          approvals: services.approvals,
          clock: services.clock,
          ids: services.ids,
          confirmationThresholdCents: services.limits.orderConfirmationThresholdCents,
          models: services.models,
          portfolios: services.portfolios,
          getAvailableToTradeCents: async (id) => {
            const now = services.clock.now();
            const accounts = await services.resolver.forCustomer(id, []);
            const balances = await deriveCustomerBalances({ ledger: services.ledger }, id, accounts, [], {
              effectiveAt: now,
              publishedAt: now,
            });
            return balances.availableToTradeCents;
          },
        },
        { customerId, modelCode: body.modelCode, requestedByActorId: customerId, confirmed: body.confirmed === true },
      );
      return reply.code(201).send({
        modelCode: result.modelCode,
        legs: result.legs.map((leg) => ({ symbol: leg.symbol, notionalCents: leg.notionalCents.toString(), status: leg.status })),
      });
    });

    authenticated.get("/customer/activity", (request) => loadActivity(services, customerOf(request)));

    authenticated.get("/customer/transfers", (request) => loadTransfers(services, customerOf(request)));

    authenticated.post("/customer/bank-accounts/link-token", async (request) => {
      const funding = requireProvider(services.funding, "plaid");
      return { linkToken: await funding.createLinkToken(customerOf(request)) };
    });

    authenticated.post("/customer/bank-accounts", async (request, reply) => {
      const body = parseBody(linkBankRequest, request.body);
      const funding = requireProvider(services.funding, "plaid");
      const record = await linkBankAccount(
        { funding, bankAccounts: services.bankAccounts, ids: services.ids, clock: services.clock },
        {
          customerId: customerOf(request),
          publicToken: body.publicToken,
          providerAccountId: body.accountId,
          institutionName: body.institutionName,
          accountMask: body.accountMask,
        },
      );
      return reply.code(201).send({
        id: record.id,
        institutionName: record.institutionName,
        accountMask: record.accountMask,
        status: record.status,
      });
    });

    authenticated.post("/customer/transfers/deposits", async (request, reply) => {
      const body = parseBody(createDepositRequest, request.body);
      const funding = requireProvider(services.funding, "plaid");
      const amountCents = parseUsd(body.amount.replace(/[$,]/g, ""));
      const record = await createDeposit(
        {
          customers: services.customers,
          bankAccounts: services.bankAccounts,
          transfers: services.transfers,
          funding,
          ids: services.ids,
          clock: services.clock,
          maximumDepositCents: services.limits.maximumDepositCents,
        },
        { customerId: customerOf(request), bankAccountId: body.bankAccountId, amountCents },
      );
      return reply.code(201).send({ id: record.id, providerTransferId: record.providerTransferId, status: "initiated" });
    });
  });
}
