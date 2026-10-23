import type { FastifyInstance } from "fastify";
import {
  findPerDiemByName,
  getStandardPerDiem,
  getZipPerDiem,
  listPerDiemDestinations,
  type AppConfig,
  type AwsClients,
} from "@compliancechat/shared";

export async function registerRateRoutes(
  app: FastifyInstance,
  clients: AwsClients,
  cfg: AppConfig,
): Promise<void> {
  // Destinations for a fiscal year, powering the Validate form autocomplete.
  app.get("/api/rates/destinations", async (req, reply) => {
    const q = req.query as { fiscalYear?: string };
    const fiscalYear = Number(q.fiscalYear);
    if (!Number.isInteger(fiscalYear)) {
      reply.status(400).send({ error: "fiscalYear query param is required" });
      return;
    }
    const rows = await listPerDiemDestinations(clients, cfg, fiscalYear);
    reply.send({
      fiscalYear,
      items: rows.map((r) => ({
        location: r.location,
        state: r.state,
        key: r.sk,
        lodging: r.lodging,
        mie: r.mie,
      })),
    });
  });

  // Resolve a 5-digit ZIP code to its per-diem destination + lodging rate.
  // M&IE is joined from the destination per-diem rows (ZIP file is lodging-only).
  app.get("/api/rates/zip", async (req, reply) => {
    const q = req.query as { fiscalYear?: string; zip?: string };
    const fiscalYear = Number(q.fiscalYear);
    const zip = String(q.zip ?? "").padStart(5, "0");
    if (!Number.isInteger(fiscalYear) || !/^\d{5}$/.test(zip)) {
      reply.status(400).send({ error: "fiscalYear and a 5-digit zip are required" });
      return;
    }
    const row = await getZipPerDiem(clients, cfg, fiscalYear, zip);
    if (!row) {
      reply.status(404).send({ error: `No per-diem destination found for ZIP ${zip} (FY${fiscalYear})` });
      return;
    }
    // Join M&IE from the destination per-diem rows; fall back to Standard CONUS.
    const dest = await findPerDiemByName(clients, cfg, fiscalYear, row.name, row.state);
    const std = dest ? null : await getStandardPerDiem(clients, cfg, fiscalYear);
    const mie = dest?.mie ?? std?.mie ?? null;
    reply.send({
      zip,
      fiscalYear,
      location: row.name,
      state: row.state,
      county: row.county,
      lodging: row.lodging,
      mie,
      mieSource: dest ? `${dest.location} (FY${fiscalYear})` : std ? "Standard CONUS" : "unknown",
    });
  });
}
