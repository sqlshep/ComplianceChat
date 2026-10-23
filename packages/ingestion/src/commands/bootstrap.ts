import { bootstrapIndex, getConfig, log, makeClients } from "@compliancechat/shared";

export async function bootstrapCmd(opts: { recreate?: boolean }): Promise<void> {
  const cfg = getConfig("ingestion");
  const clients = makeClients(cfg);
  log.info(`Bootstrapping OpenSearch index "${cfg.aoss.index}" at ${cfg.aoss.endpoint}`);
  const { created } = await bootstrapIndex(clients, cfg, { recreate: opts.recreate });
  if (created) log.info(`Index "${cfg.aoss.index}" created (knn ${cfg.bedrock.embedDim}-dim).`);
  else log.info(`Index "${cfg.aoss.index}" already exists (use --recreate to rebuild).`);
}
