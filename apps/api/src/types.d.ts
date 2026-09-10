declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
    /** Set by the customer auth hook after a valid bearer session. */
    customerId?: string;
  }
}

export {};
