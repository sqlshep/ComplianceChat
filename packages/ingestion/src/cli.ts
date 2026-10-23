#!/usr/bin/env -S npx tsx
import { Command } from "commander";
import {
  answerQuestion,
  getConfig,
  makeClients,
  validateClaim,
  ClaimSchema,
} from "@compliancechat/shared";
import { bootstrapCmd } from "./commands/bootstrap";
import { ingestCmd } from "./commands/ingest";
import { seedCmd } from "./commands/seed";
import { seedPerdiemCmd } from "./commands/seedPerdiem";
import { seedZipCmd } from "./commands/seedZip";
import { checkCmd } from "./commands/check";
import { evaluateCmd } from "./commands/evaluate";

const program = new Command();
program
  .name("compliancechat")
  .description("ComplianceChat ingestion & ops CLI (uses real AWS)")
  .version("0.1.0");

program
  .command("bootstrap")
  .description("Create the OpenSearch Serverless vector index")
  .option("--recreate", "delete and recreate the index", false)
  .action((o) => bootstrapCmd(o));

program
  .command("ingest")
  .description("Ingest a PDF: upload (versioned), extract, chunk, embed, index")
  .argument("<file>", "path to a PDF file")
  .option("--doc-id <id>", "stable document id")
  .option("--title <title>", "human document title")
  .option("--edition <edition>", "edition label used as the citation version")
  .option("--source-url <url>", "canonical source URL for provenance")
  .option("--recreate", "recreate the index before ingesting", false)
  .action((file, o) => ingestCmd(file, o));

program
  .command("seed")
  .description("Seed controls and per-diem/M&IE rates into DynamoDB")
  .option("--only <what>", "seed only 'controls' or 'rates'")
  .action((o) => seedCmd(o));

program
  .command("seed-perdiem")
  .description("Load a GSA per-diem flat file (xlsx) into the rates table")
  .argument("<file>", "path to the GSA per-diem .xlsx flat file")
  .requiredOption("--fiscal-year <year>", "fiscal year the file represents, e.g. 2027")
  .option("--upload", "also upload the source file to the versioned S3 source bucket", false)
  .action((file, o) => seedPerdiemCmd(file, o));

program
  .command("seed-zip")
  .description("Load a GSA ZIP-code per-diem flat file (xlsx) into the rates table")
  .argument("<file>", "path to the GSA ZIP-code per-diem .xlsx flat file")
  .option("--fiscal-year <year>", "fiscal year override (defaults to the file's FiscalYear column)")
  .action((file, o) => seedZipCmd(file, o));

program
  .command("check")
  .description("Check AWS connectivity and permissions for all services")
  .action(() => checkCmd());

program
  .command("eval")
  .description("Run evaluation cases end-to-end against real AWS")
  .option("--file <path>", "path to a cases .jsonl file")
  .action((o) => evaluateCmd(o));

program
  .command("ask")
  .description("Ask a question (RAG) from the CLI")
  .argument("<question...>", "the question")
  .action(async (parts: string[]) => {
    const cfg = getConfig("app");
    const clients = makeClients(cfg);
    const res = await answerQuestion(clients, cfg, parts.join(" "));
    console.log(`\n${res.answer}\n`);
    console.log("Citations:");
    res.citations.forEach((c, i) =>
      console.log(`  [${i + 1}] ${c.docTitle}${c.section ? ` ${c.section}` : ""} (v=${c.version})`),
    );
    console.log(`\ndecisionId=${res.decisionId}${res.blocked ? " (guardrail blocked)" : ""}`);
  });

program
  .command("validate")
  .description("Validate a travel claim (JSON) from the CLI")
  .requiredOption("--claim <json>", "claim as a JSON string")
  .action(async (o) => {
    const cfg = getConfig("app");
    const clients = makeClients(cfg);
    const claim = ClaimSchema.parse(JSON.parse(o.claim));
    const res = await validateClaim(clients, cfg, claim);
    console.log(`\nOutcome: ${res.outcome}\n`);
    for (const f of res.findings) {
      const icon = f.status === "pass" ? "✅" : f.status === "fail" ? "❌" : "ℹ️";
      console.log(`  ${icon} ${f.title}: ${f.message}`);
    }
    console.log(`\ndecisionId=${res.decisionId}`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error((err as Error).stack ?? String(err));
  process.exit(1);
});
