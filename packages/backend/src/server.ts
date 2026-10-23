import Fastify from "fastify";
import { getConfig, log, makeClients } from "@compliancechat/shared";
import { registerHealthRoutes } from "./routes/health";
import { registerChatRoutes } from "./routes/chat";
import { registerValidateRoutes } from "./routes/validate";
import { registerDecisionRoutes } from "./routes/decisions";
import { registerChunkRoutes } from "./routes/chunks";
import { registerRateRoutes } from "./routes/rates";

async function main() {
  const cfg = getConfig("app");
  // One set of AWS clients for the process lifetime.
  const clients = makeClients(cfg);

  const app = Fastify({ logger: false });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    log.error(`request error: ${err.message}`);
    reply.status(err.statusCode ?? 500).send({ error: err.message });
  });

  await registerHealthRoutes(app, cfg);
  await registerChatRoutes(app, clients, cfg);
  await registerValidateRoutes(app, clients, cfg);
  await registerDecisionRoutes(app, clients, cfg);
  await registerChunkRoutes(app, clients, cfg);
  await registerRateRoutes(app, clients, cfg);

  // Bind to localhost only — this is a local prototype, never deployed.
  await app.listen({ host: cfg.server.host, port: cfg.server.port });
  log.info(`ComplianceChat backend listening on http://${cfg.server.host}:${cfg.server.port}`);
  log.info(`AWS profile=${cfg.profile} region=${cfg.region}`);
}

main().catch((err) => {
  log.error("failed to start backend", err);
  process.exit(1);
});
