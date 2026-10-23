import type { AppConfig } from "../config";
import type { AwsClients } from "../aws/clients";
import {
  findPerDiemByName,
  getMieBreakdown,
  getStandardPerDiem,
  listActiveControls,
} from "../aws/dynamo";
import { recordDecision } from "./decisions";
import type {
  Citation,
  Claim,
  Control,
  RuleFinding,
  ValidationResult,
} from "../types";

type Authority = { docId: string; label: string; sourceUri?: string };

function authToCitation(a: Authority, message: string): Citation {
  return {
    chunkId: `${a.docId}:${a.label}`,
    docId: a.docId,
    docTitle: a.label,
    version: "rule",
    sourceUri: a.sourceUri ?? "",
    page: null,
    section: a.label,
    score: 1,
    snippet: message,
  };
}

function findControl(controls: Control[], ruleKey: string): Control | undefined {
  return controls.find((c) => c.ruleKey === ruleKey);
}

/**
 * Deterministic compliance validation of a travel claim against seeded per-diem
 * rates, the M&IE breakdown table, and active controls. Every finding carries
 * citations to the governing authority, and the whole evaluation is persisted
 * as a decision record.
 */
export async function validateClaim(
  clients: AwsClients,
  cfg: AppConfig,
  claim: Claim,
): Promise<ValidationResult> {
  const controls = await listActiveControls(clients, cfg).catch(() => [] as Control[]);

  // ---- rate lookup (location, else standard CONUS) ----
  const key = claim.location.trim().toUpperCase();
  let rate =
    key === "STANDARD" || key === "STANDARD CONUS"
      ? await getStandardPerDiem(clients, cfg, claim.fiscalYear)
      : await findPerDiemByName(clients, cfg, claim.fiscalYear, key, claim.state);
  let rateSource: string;
  if (rate) {
    rateSource = `${rate.location} (FY${rate.fiscalYear})`;
  } else {
    rate = await getStandardPerDiem(clients, cfg, claim.fiscalYear);
    rateSource = rate ? `Standard CONUS fallback (FY${claim.fiscalYear})` : "no rate data";
  }

  const findings: RuleFinding[] = [];
  const citations: Citation[] = [];

  const lodgingRate = rate?.lodging ?? null;
  const mieRate = rate?.mie ?? null;

  // Cite the exact per-diem rate row used (destination, lodging, M&IE, FY, source).
  if (rate) {
    const usedStandard = rateSource.startsWith("Standard CONUS fallback");
    citations.push({
      chunkId: `${rate.authority.docId}:${rate.sk}`,
      docId: rate.authority.docId,
      docTitle: rate.authority.label,
      version: `FY${rate.fiscalYear}`,
      sourceUri: rate.authority.sourceUri ?? "",
      page: null,
      section: rate.location,
      score: 1,
      snippet:
        `Per-diem rate row — ${rate.location}` +
        `${rate.state ? ` (${rate.state})` : ""}: lodging $${rate.lodging}/night, ` +
        `M&IE $${rate.mie}/day. Fiscal year ${rate.fiscalYear}.` +
        (usedStandard ? ` Applied as the Standard CONUS fallback for "${claim.location}".` : "") +
        ` Source: ${rate.authority.label}.`,
    });
  }

  // ---- Rule: lodging within per diem (or 300% if actual-expense authorized) ----
  const claimedLodging = claim.nights * claim.lodgingCostPerNight;
  const baseMax = (lodgingRate ?? 0) * claim.nights;
  const maxLodgingReimbursable = claim.actualExpenseAuthorized ? baseMax * 3 : baseMax;
  {
    const ctrl = findControl(controls, "lodging-max");
    const auth: Authority[] = ctrl?.authority ?? [
      { docId: "ftr-2021", label: "FTR 301-11.100 / 301-11.303" },
      { docId: "gsa-perdiem-faqs", label: "Per Diem FAQ #18" },
    ];
    if (lodgingRate == null) {
      findings.push({
        controlId: ctrl?.controlId ?? "lodging-max",
        title: "Lodging within per diem",
        status: "info",
        message: `No per-diem rate found for "${claim.location}" FY${claim.fiscalYear}. Seed rates to validate lodging.`,
        authority: auth,
      });
    } else if (claimedLodging <= maxLodgingReimbursable + 1e-9) {
      findings.push({
        controlId: ctrl?.controlId ?? "lodging-max",
        title: "Lodging within per diem",
        status: "pass",
        message: `Claimed lodging $${claimedLodging.toFixed(2)} is within the ${
          claim.actualExpenseAuthorized ? "300% actual-expense" : "per-diem"
        } maximum $${maxLodgingReimbursable.toFixed(2)} (rate $${lodgingRate}/night × ${claim.nights}).`,
        authority: auth,
      });
    } else {
      findings.push({
        controlId: ctrl?.controlId ?? "lodging-max",
        title: "Lodging within per diem",
        status: "fail",
        message: `Claimed lodging $${claimedLodging.toFixed(2)} EXCEEDS the ${
          claim.actualExpenseAuthorized ? "300% actual-expense" : "per-diem"
        } maximum $${maxLodgingReimbursable.toFixed(2)}. ${
          claim.actualExpenseAuthorized
            ? "Even actual-expense is capped at 300% of per diem."
            : "Request actual-expense authorization (up to 300%) if lodging at per diem was unavailable."
        }`,
        authority: auth,
      });
    }
    auth.forEach((a) => citations.push(authToCitation(a, "Lodging reimbursement limits.")));
  }

  // ---- M&IE calculation (first/last day 75%, provided-meal deductions) ----
  let mieFirstLastDay = 0;
  let mieFullDays = 0;
  let mieDeductions = 0;
  let mieTotalAllowance = 0;
  {
    const ctrl = findControl(controls, "mie-first-last-and-deductions");
    const auth: Authority[] = ctrl?.authority ?? [
      { docId: "gsa-perdiem-faqs", label: "Per Diem FAQ #15" },
      { docId: "gsa-mie-breakdowns", label: "GSA M&IE Breakdowns" },
    ];
    if (mieRate == null) {
      findings.push({
        controlId: ctrl?.controlId ?? "mie-first-last-and-deductions",
        title: "M&IE allowance",
        status: "info",
        message: `No M&IE rate found for "${claim.location}" FY${claim.fiscalYear}.`,
        authority: auth,
      });
    } else {
      const breakdown = await getMieBreakdown(clients, cfg, mieRate);
      const firstLastDays = claim.travelDays === 1 ? 1 : 2;
      const fullDays = Math.max(0, claim.travelDays - 2);
      const firstLastRate = breakdown?.firstLastDay ?? mieRate * 0.75;

      mieFirstLastDay = firstLastDays * firstLastRate;
      mieFullDays = fullDays * mieRate;

      if (breakdown) {
        mieDeductions =
          claim.providedMeals.breakfast * breakdown.breakfast +
          claim.providedMeals.lunch * breakdown.lunch +
          claim.providedMeals.dinner * breakdown.dinner;
      }
      mieTotalAllowance = Math.max(0, mieFirstLastDay + mieFullDays - mieDeductions);

      findings.push({
        controlId: ctrl?.controlId ?? "mie-first-last-and-deductions",
        title: "M&IE allowance",
        status: "info",
        message:
          `M&IE $${mieRate}/day. First/last day at 75% = $${firstLastRate.toFixed(2)} × ${firstLastDays}` +
          ` + ${fullDays} full day(s) × $${mieRate} − $${mieDeductions.toFixed(2)} provided-meal deductions` +
          ` = $${mieTotalAllowance.toFixed(2)} total M&IE.`,
        authority: auth,
      });
    }
    auth.forEach((a) =>
      citations.push(authToCitation(a, "First/last day 75% and provided-meal deductions.")),
    );
  }

  // ---- Informational rules ----
  {
    const ctrl = findControl(controls, "lodging-taxes");
    const auth: Authority[] = ctrl?.authority ?? [
      { docId: "ftr-2021", label: "FTR 301-11.16" },
      { docId: "gsa-perdiem-faqs", label: "Per Diem FAQ #11" },
    ];
    findings.push({
      controlId: ctrl?.controlId ?? "lodging-taxes",
      title: "Lodging taxes (CONUS)",
      status: "info",
      message:
        "CONUS lodging taxes are NOT in the per-diem rate; claim them separately as a miscellaneous expense, limited to taxes on the reimbursable lodging amount.",
      authority: auth,
    });
    auth.forEach((a) => citations.push(authToCitation(a, "Lodging taxes reimbursable separately.")));
  }
  {
    const ctrl = findControl(controls, "receipts");
    const auth: Authority[] = ctrl?.authority ?? [
      { docId: "ftr-2021", label: "FTR 301-11.25" },
      { docId: "gsa-perdiem-faqs", label: "Per Diem FAQ #17" },
    ];
    findings.push({
      controlId: ctrl?.controlId ?? "receipts",
      title: "Receipts",
      status: "info",
      message:
        "Provide a lodging receipt and receipts for any authorized expense over $75 (or an acceptable written explanation).",
      authority: auth,
    });
    auth.forEach((a) => citations.push(authToCitation(a, "Receipt requirements.")));
  }

  const outcome: "PASS" | "FAIL" = findings.some((f) => f.status === "fail") ? "FAIL" : "PASS";

  const computed = {
    lodgingRate,
    mieRate,
    maxLodgingReimbursable,
    claimedLodging,
    mieFirstLastDay,
    mieFullDays,
    mieDeductions,
    mieTotalAllowance,
    rateSource,
  };

  const record = await recordDecision(clients, cfg, {
    type: "validation",
    query: `validate claim: ${claim.location} FY${claim.fiscalYear}`,
    outcome,
    citations,
    evidence: {
      input: claim,
      retrieval: [],
      prompt: { system: "deterministic-compliance-engine", groundingSource: rateSource, query: "" },
      rawModelOutput: "",
      result: { outcome, findings, computed },
    },
  });

  return { decisionId: record.decisionId, outcome, findings, computed, citations };
}
