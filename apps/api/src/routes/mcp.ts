import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createAgentServer } from "@corgi/mcp";
import type { ApiConfig } from "../config.js";
import type { ApiServices } from "../services.js";

function authorized(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const secret = Buffer.from(expected);
  return supplied.length === secret.length && timingSafeEqual(supplied, secret);
}

export async function registerMcpRoute(
  app: FastifyInstance,
  services: ApiServices,
  config: ApiConfig,
): Promise<void> {
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    handler: async (request, reply) => {
      if (!authorized(request.headers.authorization, config.MCP_API_KEY)) {
        return reply.code(401).send({ error: "unauthorized" });
      }

      // Stateless mode is sufficient for tools and scales horizontally without
      // an in-memory session registry. Each request receives a fresh server.
      const server = createAgentServer(services.agentReads, services.agentWrites);
      const transport = new StreamableHTTPServerTransport();
      await server.connect(transport);
      reply.hijack();
      await transport.handleRequest(request.raw, reply.raw, request.body);
    },
  });
}
