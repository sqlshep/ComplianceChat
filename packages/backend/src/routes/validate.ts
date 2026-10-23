import type { FastifyInstance } from "fastify";
import { ClaimSchema, validateClaim, type AppConfig, type AwsClients } from "@compliancechat/shared";

export async function registerValidateRoutes(
  app: FastifyInstance,
  clients: AwsClients,
  cfg: AppConfig,
): Promise<void> {
  app.post("/api/validate", async (req, reply) => {
    const parsed = ClaimSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.status(400).send({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      return;
    }
    const res = await validateClaim(clients, cfg, parsed.data);
    reply.send(res);
  });
}
