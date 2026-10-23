import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import type { AppConfig } from "../config";
import type { AwsClients } from "./clients";
import type {
  Control,
  DecisionRecord,
  MieBreakdown,
  PerDiemRate,
  RateRow,
  ZipPerDiemRate,
} from "../types";

/* --------------------------------- Controls --------------------------------- */

export async function putControl(c: AwsClients, cfg: AppConfig, control: Control): Promise<void> {
  await c.ddb.send(new PutCommand({ TableName: cfg.dynamo.controlsTable, Item: control }));
}

export async function listActiveControls(c: AwsClients, cfg: AppConfig): Promise<Control[]> {
  const res = await c.ddb.send(
    new QueryCommand({
      TableName: cfg.dynamo.controlsTable,
      IndexName: "status-index",
      KeyConditionExpression: "#s = :active",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":active": "active" },
    }),
  );
  return (res.Items ?? []) as Control[];
}

/* ----------------------------------- Rates ----------------------------------- */

export async function putRate(c: AwsClients, cfg: AppConfig, row: RateRow): Promise<void> {
  await c.ddb.send(new PutCommand({ TableName: cfg.dynamo.ratesTable, Item: row }));
}

/**
 * Bulk-write rate rows (25 per BatchWrite request) with bounded concurrency and
 * retry of unprocessed items. Returns the number of items written. `onProgress`
 * is called with the running total after each batch completes.
 */
export async function batchPutRates(
  c: AwsClients,
  cfg: AppConfig,
  rows: RateRow[],
  onProgress?: (written: number) => void,
): Promise<number> {
  const table = cfg.dynamo.ratesTable;
  const batches: RateRow[][] = [];
  for (let i = 0; i < rows.length; i += 25) batches.push(rows.slice(i, i + 25));

  let written = 0;
  const concurrency = 8;
  for (let i = 0; i < batches.length; i += concurrency) {
    const slice = batches.slice(i, i + concurrency);
    await Promise.all(
      slice.map(async (batch) => {
        let requestItems: Record<string, { PutRequest: { Item: RateRow } }[]> = {
          [table]: batch.map((Item) => ({ PutRequest: { Item } })),
        };
        for (let attempt = 0; attempt < 6; attempt++) {
          const res = await c.ddb.send(new BatchWriteCommand({ RequestItems: requestItems }));
          const unprocessed = res.UnprocessedItems?.[table] as
            | { PutRequest: { Item: RateRow } }[]
            | undefined;
          if (!unprocessed || unprocessed.length === 0) break;
          requestItems = { [table]: unprocessed };
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
        }
      }),
    );
    written += slice.reduce((n, b) => n + b.length, 0);
    onProgress?.(written);
  }
  return written;
}

export async function getZipPerDiem(
  c: AwsClients,
  cfg: AppConfig,
  fiscalYear: number,
  zip: string,
): Promise<ZipPerDiemRate | null> {
  const res = await c.ddb.send(
    new QueryCommand({
      TableName: cfg.dynamo.ratesTable,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": `ZIP#${fiscalYear}#${zip}` },
      Limit: 1,
    }),
  );
  return (res.Items?.[0] as ZipPerDiemRate) ?? null;
}

export async function getPerDiem(
  c: AwsClients,
  cfg: AppConfig,
  fiscalYear: number,
  key: string,
): Promise<PerDiemRate | null> {
  const pk = `PERDIEM#${fiscalYear}#${key.toUpperCase()}`;
  const res = await c.ddb.send(
    new QueryCommand({
      TableName: cfg.dynamo.ratesTable,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": pk },
      Limit: 1,
    }),
  );
  return (res.Items?.[0] as PerDiemRate) ?? null;
}

export async function getStandardPerDiem(
  c: AwsClients,
  cfg: AppConfig,
  fiscalYear: number,
): Promise<PerDiemRate | null> {
  return getPerDiem(c, cfg, fiscalYear, "STANDARD");
}

/**
 * Resolve a per-diem rate by destination name: exact key match first, then a
 * case-insensitive "contains" match against destination keys/locations for the
 * fiscal year (so "New York" resolves to "New York City"). The Standard CONUS
 * row is never returned here. Returns null if nothing matches.
 */
export async function findPerDiemByName(
  c: AwsClients,
  cfg: AppConfig,
  fiscalYear: number,
  query: string,
  state?: string | null,
): Promise<PerDiemRate | null> {
  const q = query.trim().toUpperCase();
  const st = state?.trim().toUpperCase() || null;
  if (!q) return null;

  // Exact match, preferring a "<name>, <state>" key when a state is given.
  if (st) {
    const exactWithState = await getPerDiem(c, cfg, fiscalYear, `${q}, ${st}`);
    if (exactWithState) return exactWithState;
  }
  const exact = await getPerDiem(c, cfg, fiscalYear, q);
  if (exact) return exact;

  const res = await c.ddb.send(
    new ScanCommand({
      TableName: cfg.dynamo.ratesTable,
      FilterExpression: "begins_with(pk, :p)",
      ExpressionAttributeValues: { ":p": `PERDIEM#${fiscalYear}#` },
    }),
  );
  const items = (res.Items ?? []) as PerDiemRate[];
  let candidates = items.filter(
    (i) =>
      i.sk !== "STANDARD" &&
      (i.sk?.toUpperCase().includes(q) || String(i.location ?? "").toUpperCase().includes(q)),
  );
  if (candidates.length === 0) return null;
  // If a state was provided, prefer rows in that state (disambiguates same-named
  // cities like Dallas TX vs Dallas IA).
  if (st) {
    const inState = candidates.filter((i) => (i.state ?? "").toUpperCase() === st);
    if (inState.length) candidates = inState;
  }
  // Prefer the shortest matching name (closest to an exact destination).
  candidates.sort((a, b) => (a.sk?.length ?? 0) - (b.sk?.length ?? 0));
  return candidates[0] ?? null;
}

/**
 * List all per-diem destinations for a fiscal year (excluding the Standard
 * CONUS row), sorted by location. Used to power the destination autocomplete.
 */
export async function listPerDiemDestinations(
  c: AwsClients,
  cfg: AppConfig,
  fiscalYear: number,
): Promise<PerDiemRate[]> {
  const items: PerDiemRate[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await c.ddb.send(
      new ScanCommand({
        TableName: cfg.dynamo.ratesTable,
        FilterExpression: "begins_with(pk, :p)",
        ExpressionAttributeValues: { ":p": `PERDIEM#${fiscalYear}#` },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const i of (res.Items ?? []) as PerDiemRate[]) {
      if (i.sk !== "STANDARD") items.push(i);
    }
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  items.sort((a, b) => a.location.localeCompare(b.location));
  return items;
}

/** Find the M&IE breakdown row for the smallest total >= mie, else the largest. */
export async function getMieBreakdown(
  c: AwsClients,
  cfg: AppConfig,
  mieTotal: number,
): Promise<MieBreakdown | null> {
  const res = await c.ddb.send(
    new QueryCommand({
      TableName: cfg.dynamo.ratesTable,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "MIE#CONUS" },
    }),
  );
  const rows = (res.Items ?? []) as MieBreakdown[];
  const exact = rows.find((r) => r.mieTotal === mieTotal);
  if (exact) return exact;
  return rows.sort((a, b) => a.mieTotal - b.mieTotal).find((r) => r.mieTotal >= mieTotal) ?? null;
}

/* --------------------------------- Decisions --------------------------------- */

export async function putDecision(
  c: AwsClients,
  cfg: AppConfig,
  record: DecisionRecord,
): Promise<void> {
  await c.ddb.send(new PutCommand({ TableName: cfg.dynamo.decisionsTable, Item: record }));
}

export async function getDecision(
  c: AwsClients,
  cfg: AppConfig,
  decisionId: string,
): Promise<DecisionRecord | null> {
  const res = await c.ddb.send(
    new GetCommand({ TableName: cfg.dynamo.decisionsTable, Key: { decisionId } }),
  );
  return (res.Item as DecisionRecord) ?? null;
}

export async function listRecentDecisions(
  c: AwsClients,
  cfg: AppConfig,
  limit = 25,
): Promise<DecisionRecord[]> {
  const res = await c.ddb.send(
    new QueryCommand({
      TableName: cfg.dynamo.decisionsTable,
      IndexName: "created-index",
      KeyConditionExpression: "entityType = :e",
      ExpressionAttributeValues: { ":e": "DECISION" },
      ScanIndexForward: false,
      Limit: limit,
    }),
  );
  return (res.Items ?? []) as DecisionRecord[];
}

export async function countTableItems(
  c: AwsClients,
  tableName: string,
): Promise<number> {
  const res = await c.ddb.send(new ScanCommand({ TableName: tableName, Select: "COUNT" }));
  return res.Count ?? 0;
}
