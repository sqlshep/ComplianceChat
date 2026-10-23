import type { FastifyInstance } from "fastify";
import { getChunkById, type AppConfig, type AwsClients } from "@compliancechat/shared";

export async function registerChunkRoutes(
  app: FastifyInstance,
  clients: AwsClients,
  cfg: AppConfig,
): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/chunks/:id", async (req, reply) => {
    const chunk = await getChunkById(clients, cfg, req.params.id);
    if (!chunk) {
      reply.status(404).send({ error: "chunk not found" });
      return;
    }
    reply.send({ chunk });
  });
}
