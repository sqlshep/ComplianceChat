import type { FastifyInstance } from "fastify";
import { runConnectivityChecks, type AppConfig } from "@compliancechat/shared";

export async function registerHealthRoutes(app: FastifyInstance, cfg: AppConfig): Promise<void> {
  // Fast liveness check — no AWS calls.
  app.get("/api/health", async () => ({
    status: "ok",
    region: cfg.region,
    profile: cfg.profile,
    index: cfg.aoss.index,
  }));

  // Deep check — makes real AWS calls across every dependency.
  app.get("/api/health/aws", async (_req, reply) => {
    const { results, ok } = await runConnectivityChecks("app", cfg);
    reply.status(ok ? 200 : 503).send({ ok, results });
  });
}
