import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  answerQuestion,
  generatePlain,
  getConfig,
  log,
  makeClients,
} from "@compliancechat/shared";

interface EvalCase {
  id: string;
  question: string;
  /** Key facts / reference answer the response should reflect. */
  expected: string;
  /** If true, the answer must include at least one citation. */
  mustCite?: boolean;
}

interface Judged {
  id: string;
  score: number;
  verdict: string;
  grounded: boolean;
  citations: number;
  rationale: string;
}

const JUDGE_SYSTEM = `You are a strict evaluator for a federal travel compliance assistant.
Given a QUESTION, a REFERENCE (key facts), and the ASSISTANT ANSWER, score how well the
answer matches the reference facts and is supported by citations. Respond with ONLY a JSON
object: {"score": <0..1>, "grounded": <true|false>, "verdict": "pass"|"fail", "rationale": "<short>"}.`;

function parseJson(s: string): any {
  const cleaned = s.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(cleaned.slice(start, end + 1));
}

export interface EvalOptions {
  file?: string;
}

export async function evaluateCmd(opts: EvalOptions): Promise<void> {
  const cfg = getConfig("app");
  const clients = makeClients(cfg);

  const path = opts.file ?? fileURLToPath(new URL("../../../../eval/cases.jsonl", import.meta.url));
  const lines = (await readFile(path, "utf8")).split("\n").map((l) => l.trim()).filter(Boolean);
  const cases: EvalCase[] = lines.map((l) => JSON.parse(l));
  log.info(`Running ${cases.length} evaluation case(s) against real AWS...`);

  const judged: Judged[] = [];
  for (const c of cases) {
    const res = await answerQuestion(clients, cfg, c.question);
    const citeList = res.citations
      .map((x, i) => `[${i + 1}] ${x.docTitle}${x.section ? ` ${x.section}` : ""}`)
      .join("; ");
    const raw = await generatePlain(clients, cfg, {
      system: JUDGE_SYSTEM,
      user: `QUESTION:\n${c.question}\n\nREFERENCE:\n${c.expected}\n\nASSISTANT ANSWER:\n${res.answer}\n\nCITATIONS: ${citeList || "none"}`,
    });
    let parsed: any = { score: 0, grounded: false, verdict: "fail", rationale: "unparseable judge output" };
    try {
      parsed = parseJson(raw);
    } catch {
      /* keep default */
    }
    const citeOk = c.mustCite ? res.citations.length > 0 : true;
    judged.push({
      id: c.id,
      score: Number(parsed.score ?? 0),
      verdict: citeOk ? parsed.verdict ?? "fail" : "fail",
      grounded: Boolean(parsed.grounded) && citeOk,
      citations: res.citations.length,
      rationale: String(parsed.rationale ?? ""),
    });
  }

  console.log("\nEvaluation results:\n");
  for (const j of judged) {
    const icon = j.verdict === "pass" ? "✅" : "❌";
    console.log(`  ${icon}  ${j.id.padEnd(22)} score=${j.score.toFixed(2)} cites=${j.citations}  ${j.rationale}`);
  }
  const avg = judged.reduce((a, j) => a + j.score, 0) / (judged.length || 1);
  const passed = judged.filter((j) => j.verdict === "pass").length;
  console.log(`\n${passed}/${judged.length} passed; mean score ${avg.toFixed(2)}\n`);
  if (passed < judged.length) process.exitCode = 1;
}
