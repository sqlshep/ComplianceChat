import type { FastifyInstance } from "fastify";
import {
  getDecision,
  getJson,
  listRecentDecisions,
  type AppConfig,
  type AwsClients,
  type DecisionEvidence,
} from "@compliancechat/shared";

export async function registerDecisionRoutes(
  app: FastifyInstance,
  clients: AwsClients,
  cfg: AppConfig,
): Promise<void> {
  app.get("/api/decisions", async () => {
    const items = await listRecentDecisions(clients, cfg, 50);
    return { items };
  });

  app.get<{ Params: { id: string }; Querystring: { evidence?: string } }>(
    "/api/decisions/:id",
    async (req, reply) => {
      const record = await getDecision(clients, cfg, req.params.id);
      if (!record) {
        reply.status(404).send({ error: "decision not found" });
        return;
      }
      let evidence: DecisionEvidence | undefined;
      if (req.query.evidence === "1") {
        // evidenceUri is s3://bucket/key
        const m = record.evidenceUri.match(/^s3:\/\/([^/]+)\/(.+)$/);
        if (m) evidence = await getJson<DecisionEvidence>(clients, m[1]!, m[2]!);
      }
      reply.send({ record, evidence });
    },
  );
}
