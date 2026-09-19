"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import dynamic from "next/dynamic";
import { RiskReport } from "@/components/report/RiskReport";
import { ClinicalOverview } from "@/components/report/ClinicalOverview";
import { ClinicalReviewPriorities } from "@/components/report/ClinicalReviewPriorities";
import type { ReviewPriorityItem } from "@/components/report/ClinicalReviewPriorities";
import { DataStream } from "@/components/effects/DataStream";
import { GridBackground } from "@/components/effects/GridBackground";
import type {
  AnalyzeResponse,
  AnalyzeRequest,
  InteractionGraph,
  CascadeModel,
  DeprescribingPlan,
  Severity,
} from "@/lib/types";
import { getActionLabel } from "@/lib/severity";
import { resolveMedicationCount } from "@/lib/medicationCount";
import { isUpstreamModelError } from "@/lib/narrative";
import { EvidenceSummary } from "@/components/report/EvidenceSummary";
import {
  resolveGraph as resolveRealGraph,
  resolveTemporal as resolveRealTemporal,
  resolveDeprescribing as resolveRealDeprescribing,
  resolveInteractionTotals,
  rawInteractionList as snapshotInteractions,
  readSnapshot,
  type ReportSnapshotSource,
} from "@/lib/reportSnapshot";
import { PreGeneratedDemoReport } from "@/components/report/PreGeneratedDemoReport";

const Scene = dynamic(
  () => import("@/components/3d/Scene").then((m) => ({ default: m.Scene })),
  { ssr: false },
);
const InteractionGraph3D = dynamic(
  () => import("@/components/3d/InteractionGraph3D").then((m) => ({ default: m.InteractionGraph3D })),
  { ssr: false },
);
const TemporalTimeline3D = dynamic(
  () => import("@/components/3d/TemporalTimeline3D").then((m) => ({ default: m.TemporalTimeline3D })),
  { ssr: false },
);
const PhenotypeRadar3D = dynamic(
  () => import("@/components/3d/PhenotypeRadar3D").then((m) => ({ default: m.PhenotypeRadar3D })),
  { ssr: false },
);
// Type-only imports so we can type the hover/click payloads without pulling
// the heavy 3D modules into the SSR bundle. Each 3D component exports a
// payload shape the parent's side panel can render.
import type { RadarHoverPayload } from "@/components/3d/PhenotypeRadar3D";
import type { NodeClickPayload } from "@/components/3d/InteractionGraph3D";
import type { TimelineHoverPayload } from "@/components/3d/TemporalTimeline3D";
import type { DeprescribingClickPayload } from "@/components/3d/DeprescribingWaterfall";
const DeprescribingWaterfall = dynamic(
  () => import("@/components/3d/DeprescribingWaterfall").then((m) => ({ default: m.DeprescribingWaterfall })),
  { ssr: false },
);
const PatientAvatar3D = dynamic(
  () => import("@/components/3d/PatientAvatar3D").then((m) => ({ default: m.PatientAvatar3D })),
  { ssr: false },
);
const FloatingParticles = dynamic(
  () => import("@/components/3d/FloatingParticles").then((m) => ({ default: m.FloatingParticles })),
  { ssr: false },
);

// ── Jakarta timezone — English format with GMT+7 ──────────
function formatJakartaTime(date?: Date): string {
  const d = date || new Date();
  return d.toLocaleString("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }) + " GMT+7";
}

// ── Risk helpers ──────────────────────────────────────────
// These mirror `src/lib/severity.ts` exactly. Do NOT diverge — every
// surface (this page, the InteractionCard, the SeverityMeter, the
// exported HTML/PDF, the Prompt Opinion artifact via the Python agent)
// must agree on score → color → label or the user sees mismatches like
// "10.0 / 10 CRITICAL" tagged as MODERATE in amber.
const SEVERITY_COLORS: Record<string, string> = {
  low: "#10b981", moderate: "#f59e0b", high: "#f97316", critical: "#ff0040",
};

// Map a (clamped) numeric 0–10 score to the canonical risk band. Same
// thresholds as `severity.ts`. Used by the Overall Risk Assessment card,
// the HTML/PDF export, and the Patient Summary quick stats. Returning a
// rich object rather than just a label so colors / bg / interpretation
// stay co-located and can't drift.
function getRiskLevelFromScore(score: number): {
  label: string;
  level: "low" | "moderate" | "high" | "critical";
  color: string;
  bgColor: string;
  description: string;
} {
  const s = Number.isFinite(score) ? Math.max(0, Math.min(10, score)) : 0;
  if (s >= 8.5) return {
    label: "CRITICAL RISK",
    level: "critical",
    color: "#ff0040",
    bgColor: "rgba(255,0,64,0.08)",
    description: "Urgent clinical review recommended. High probability of severe adverse drug events without prompt action.",
  };
  if (s >= 5.0) return {
    label: "HIGH RISK",
    level: "high",
    color: "#f97316",
    bgColor: "rgba(249,115,22,0.08)",
    description: "Significant clinical concern. Clinical review of therapy, including potential deprescribing or substitution, is recommended.",
  };
  if (s >= 2.0) return {
    label: "MODERATE RISK",
    level: "moderate",
    color: "#f59e0b",
    bgColor: "rgba(245,158,11,0.08)",
    description: "Enhanced monitoring recommended. Consider dose adjustments or alternative therapies if risk factors change.",
  };
  return {
    label: "LOW RISK",
    level: "low",
    color: "#10b981",
    bgColor: "rgba(16,185,129,0.08)",
    description: "Minimal clinical concern. Standard monitoring protocols are adequate.",
  };
}

// Legacy string-based wrapper kept so older call sites (e.g. fallback
// paths that only have a label string) still work. It now goes through
// the numeric helper to guarantee the same color/threshold mapping.
function getRiskLevel(level: string | undefined) {
  const s = (level ?? "moderate").toLowerCase();
  // String level → band midpoint score, then back through the numeric
  // mapper. Mid-band scores are chosen so a stringified label round-trips
  // to its own band.
  const fallbackScore =
    s === "critical" ? 9.25 :
    s === "high" ? 6.75 :
    s === "moderate" ? 3.5 :
    s === "low" ? 1.0 : 3.5;
  return getRiskLevelFromScore(fallbackScore);
}

function getNumericRiskScore(
  data: AnalyzeResponse,
  graph?: InteractionGraph | null,
  request?: AnalyzeRequest | null,
): number {
  // Highest priority: the agent already gave us an authoritative numeric
  // score for the whole regimen (`overall_risk_score`, written by the
  // Python `report_builder._enforce_overall_risk` step). Trust it before
  // re-deriving from the graph, because the agent score already accounts
  // for phenotype multipliers and emergent multi-drug interactions that
  // the graph-only derivation misses.
  const reportScore = (data.report as any)?.overall_risk_score;
  if (typeof reportScore === "number" && Number.isFinite(reportScore)) {
    return Math.max(0, Math.min(10, reportScore));
  }
  // Otherwise derive from the graph (used for demo data and any payload
  // that ships without a numeric overall score).
  if (graph && graph.edges && graph.edges.length > 0) {
    return deriveNumericRiskFromGraph(graph, phenotypeMultiplier(request ?? null));
  }
  // Last resort: map the string level to a band midpoint. Same midpoints
  // as `getRiskLevel` so round-tripping stays stable.
  const level = (data.report?.overall_risk_level ?? "moderate").toLowerCase();
  return { low: 1.0, moderate: 3.5, high: 6.75, critical: 9.25 }[level] ?? 3.5;
}

// ══════════════════════════════════════════════════════════
// REQUEST-DERIVED HELPERS
// ══════════════════════════════════════════════════════════
//
// The report is a STRICT single-source-of-truth view of ONE completed
// analysis. Demo fixtures (Quick Test profiles / SAMPLE_PROFILES) are used
// ONLY to prefill the Analyze form; synthetic graph/timeline/plan builders
// were removed so demo data can never populate report metrics. The helpers
// below are request-derived utilities only — drug-name normalization and
// the risk-score derivation path used when the backend did not ship an
// authoritative numeric overall score.

// ── Utilities ─────────────────────────────────────────────

function extractDrugNames(request: AnalyzeRequest | null): string[] {
  const meds = request?.medications ?? [];
  if (meds.length === 0) {
    return ["Warfarin", "Aspirin", "Omeprazole", "Metformin", "Lisinopril"];
  }
  return meds.map((m) => (typeof m === "string" ? m : m.name)).filter(Boolean);
}

function titleCase(s: string): string {
  return s.trim().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function phenotypeMultiplier(request: AnalyzeRequest | null): number {
  const p = request?.patient;
  if (!p) return 1.0;
  let m = 1.0;
  if ((p.age ?? 0) >= 80) m *= 1.35;
  else if ((p.age ?? 0) >= 65) m *= 1.2;
  if ((p.ckd_stage ?? 0) >= 4) m *= 1.3;
  else if ((p.ckd_stage ?? 0) >= 3) m *= 1.18;
  if (p.hepatic_impairment) m *= 1.22;
  if (p.smoking) m *= 1.08;
  if (p.sex === "female") m *= 1.04;
  return m;
}

// ── Numeric risk score derivation ─────────────────────────
// Used by the Overall Risk Assessment card. Previously hardcoded to
// {low: 2.5, moderate: 5.0, ...}. Now biased by the demo graph so the big
// number on the right actually reflects the visualization.

function deriveNumericRiskFromGraph(graph: InteractionGraph | null, multiplier: number): number {
  const edges = graph?.edges ?? [];
  if (edges.length === 0) return 2.5;
  // Severity → numeric weight. Tuned so the demo shows a visible gradient
  // across the 3 Quick Test profiles rather than all pegging at 9.8.
  const weight: Record<Severity, number> = { low: 2, moderate: 4.5, high: 6.8, critical: 8.5 };
  let total = 0;
  let max = 0;
  for (const e of edges) {
    const w = weight[e.severity];
    total += w;
    if (w > max) max = w;
  }
  // 45% max + 55% average → spreads scores more, high-volume interaction
  // graphs don't automatically saturate.
  const avg = total / edges.length;
  const base = max * 0.45 + avg * 0.55;
  return Math.min(9.6, Math.max(0.5, Math.round(base * multiplier * 10) / 10));
}

// ── PDF/HTML Report ─────────────────────────────────────
function generateReportHTML(data: AnalyzeResponse, request: AnalyzeRequest | null): string {
  const report = data.report;

  // Resolve all four datasets with the same STRICT real-only rule as the
  // UI: empty backend sections resolve to null (never demo substitutes), so
  // the exported PDF/HTML mirrors exactly what the user saw on screen.
  const resolvedGraph = resolveRealGraph(data);
  const resolvedTemporal = resolveRealTemporal(data);
  const resolvedDep = resolveRealDeprescribing(data);
  const exportedTotals = resolveInteractionTotals(data);

  const numScore = getNumericRiskScore(data, resolvedGraph, request);
  // Same rule as the on-screen report: derive label + color from the
  // *numeric* score, never from the LLM-emitted string field. See the
  // comment in the main report block for the rationale.
  const riskInfo = getRiskLevelFromScore(numScore);

  // Medication count resolved from real backend sources only (never a
  // fabricated 0), and narrative error guard: an upstream model/API error
  // string must not be exported as if it were clinical narrative.
  const resolvedMedCount = resolveMedicationCount(data, resolvedGraph, request);
  const modelErr = isUpstreamModelError((report as any)?.raw_text ?? report?.report_text);
  const modelNote = modelErr
    ? `<div style="padding:10px 14px;margin-bottom:18px;border:1px solid rgba(249,115,22,0.35);background:rgba(249,115,22,0.08);border-radius:8px;color:#fbbf24;font-size:13px;line-height:1.5"><strong>Narrative summary temporarily unavailable.</strong> Structured clinical analysis remains available. Please retry later.</div>`
    : "";

  const now = formatJakartaTime();
  const patientCtx = request?.patient || { age: 0, sex: "unknown", ckd_stage: 0, hepatic_impairment: false, smoking: false, comorbidities: [], allergies: [] } as any;
  const summary = report?.patient_summary
    ? { headline: report.patient_summary, bullets: [] as PatientSummaryData["bullets"] }
    : buildPatientSummary(patientCtx, data, resolvedGraph, resolvedTemporal, resolvedDep, request);

  // ── Section builders ──────────────────────────────────

  // Interaction rows: prefer raw_interactions (richer); fall back to the
  // real graph edges. When the response carries neither, the interaction
  // section is omitted entirely (no demo data ever appears in the export).
  const rawIx = snapshotInteractions(data);

  // Decide whether to show the Evidence and Confidence columns in the
  // exported table. If every row would be "—" (because the agent hasn't
  // populated `evidence_grade` and `confidence_score` for any interaction),
  // showing the columns just looks like the export is broken. We hide them
  // entirely in that case and re-emit narrower rows.
  const hasAnyEvidence =
    rawIx.length > 0 &&
    rawIx.some(
      (ix) =>
        ix.evidence_grade != null ||
        ix.confidence_score != null,
    );
  const showEvidenceCols = hasAnyEvidence;

  const interactionRowsFinal = rawIx.length > 0
    ? rawIx.map((ix) => `
        <tr>
          <td>${esc((ix.drugs ?? []).join(" + "))}</td>
          <td><span class="sev sev-${ix.severity}">${esc(ix.severity.toUpperCase())}</span></td>
          <td>${esc(ix.description)}</td>
          ${showEvidenceCols
            ? `<td>${esc(ix.evidence_grade ?? "—")}</td>
               <td>${ix.confidence_score != null ? ix.confidence_score + "%" : "—"}</td>`
            : ""}
        </tr>`).join("")
    : resolvedGraph
      ? resolvedGraph.edges.map((e) => `
        <tr>
          <td>${esc(e.source)} + ${esc(e.target)}</td>
          <td><span class="sev sev-${e.severity}">${esc(e.severity.toUpperCase())}</span></td>
          <td>${esc(e.interaction_type)}</td>
          ${showEvidenceCols
            ? `<td>—</td>
               <td>${Math.round((e.weight ?? 0) * 100)}%</td>`
            : ""}
        </tr>`).join("")
      : "";

  const totalInteractions = exportedTotals.total;
  const criticalCount = exportedTotals.critical ?? 0;
  const highCount = exportedTotals.high ?? 0;
  const hubDrugs = (resolvedGraph?.hub_drugs ?? []);
  const emergent = (resolvedGraph?.emergent_interactions ?? []).length > 0
    ? resolvedGraph!.emergent_interactions
    : [];
  const graphNodeCount = resolvedGraph?.nodes.length ?? 0;

  // Timeline section — only from a real temporal model.
  const peakScore = resolvedTemporal?.peak_risk_score ?? 0;
  const peakDay = resolvedTemporal?.peak_risk_day ?? 0;
  const windows = resolvedTemporal?.intervention_windows ?? [];
  const keyEvents = resolvedTemporal
    ? (resolvedTemporal.daily_risk ?? []).filter((d) => d.key_event)
    : [];

  const windowRows = windows.map((w) => `
    <tr>
      <td>Day ${w.day_start}–${w.day_end}</td>
      <td>${esc(w.action ?? "")}</td>
      <td><span class="urg urg-${w.urgency ?? "standard"}">${esc((w.urgency ?? "standard").toUpperCase())}</span></td>
    </tr>`).join("");

  const keyEventRows = keyEvents.map((d) => `
    <tr>
      <td>Day ${d.day}</td>
      <td>${esc(d.key_event ?? "")}</td>
      <td>${(d.risk_score ?? 0).toFixed(1)}/10</td>
    </tr>`).join("");

  // Deprescribing section
  const depRows = resolvedDep && (resolvedDep.steps ?? []).length > 0
    ? (resolvedDep.steps ?? []).map((s) => `
    <tr>
      <td>#${s.priority}</td>
      <td><strong>${esc(s.drug)}</strong></td>
      <td><span class="act act-${s.action}">${esc(getActionLabel(s.action))}</span></td>
      <td>${esc(s.substitute ?? "—")}</td>
      <td class="reduction">-${s.expected_risk_reduction}%</td>
      <td>${esc(s.timeline ?? "—")}</td>
      <td>${esc(s.rationale ?? "")}</td>
    </tr>`).join("") : "";

  // Phenotype section
  const phenoRows = `
    <tr><td>Age</td><td>${patientCtx.age ?? "—"}</td></tr>
    <tr><td>Sex</td><td>${esc(patientCtx.sex ?? "unknown")}</td></tr>
    <tr><td>Weight</td><td>${patientCtx.weight_kg ? patientCtx.weight_kg + " kg" : "—"}</td></tr>
    <tr><td>CKD Stage</td><td>${patientCtx.ckd_stage ?? 0}</td></tr>
    <tr><td>Hepatic Function</td><td>${patientCtx.hepatic_impairment ? "Impaired" : "Normal"}</td></tr>
    <tr><td>Smoking</td><td>${patientCtx.smoking ? "Active" : "No"}</td></tr>
    ${(patientCtx.comorbidities ?? []).length > 0
      ? `<tr><td>Comorbidities</td><td>${esc((patientCtx.comorbidities ?? []).join(", "))}</td></tr>`
      : ""}
    ${(patientCtx.allergies ?? []).length > 0
      ? `<tr><td>Allergies</td><td>${esc((patientCtx.allergies ?? []).join(", "))}</td></tr>`
      : ""}
  `;

  const summaryBullets = summary.bullets.length > 0
    ? `<ul class="bullets">${summary.bullets.map((b) => `
        <li>
          <span class="bl">${esc(b.label)}</span>
          <span class="bv" style="color:${b.color ?? "#ea580c"}">${esc(b.value)}</span>
        </li>
      `).join("")}</ul>`
    : "";

  // ── Assemble HTML ─────────────────────────────────────

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>RxNexus Clinical Report — ${now}</title>
<style>
  /* Proper PDF page margins — @page controls the actual paper margins
     when the browser renders to PDF. Padding on body is for on-screen
     preview only. */
  @page {
    size: A4 portrait;
    margin: 18mm 15mm 20mm 15mm;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif; background: #020817; color: #f1f5f9; line-height: 1.65; padding: 56px 48px; }
  .c { max-width: 960px; margin: 0 auto; }

  /* Animated gradient title — same effect as the About page. */
  @keyframes shimmerTitle {
    0%   { background-position: -200% center; }
    100% { background-position:  200% center; }
  }
  h1.title {
    font-size: 36px;
    font-weight: 800;
    letter-spacing: -0.02em;
    background: linear-gradient(90deg, #00e5ff 0%, #38bdf8 25%, #7c4dff 50%, #38bdf8 75%, #00e5ff 100%);
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: shimmerTitle 4s linear infinite;
    margin-bottom: 6px;
    line-height: 1.1;
  }
  h2 { font-size: 19px; color: #06b6d4; margin: 36px 0 14px; padding-bottom: 10px; border-bottom: 1px solid #1e3a5f; font-weight: 700; page-break-after: avoid; }
  h3 { font-size: 14px; color: #94a3b8; margin: 18px 0 10px; font-weight: 600; page-break-after: avoid; }
  p  { margin-bottom: 12px; color: #cbd5e1; }

  .hdr { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; padding-bottom: 22px; border-bottom: 2px solid #1e3a5f; gap: 28px; }
  .hdr .meta { flex: 1; }
  .sub { color: #94a3b8; font-size: 13px; margin-bottom: 4px; }

  /* Risk badge — score in orange+bold, border thick blue (distinct from fill) */
  .rb {
    padding: 18px 32px;
    border-radius: 16px;
    text-align: center;
    background: #0b1a33;
    border: 3px solid #06b6d4; /* thick blue — distinguishes from the orange score */
    box-shadow: 0 0 24px rgba(6,182,212,0.25);
    min-width: 150px;
  }
  .rb .sc {
    font-size: 48px;
    font-weight: 900;
    color: ${riskInfo.color}; /* color derived from the actual band, not hard-coded orange */
    line-height: 1;
    margin-bottom: 6px;
  }
  .rb .sc .denom { font-size: 20px; color: #64748b; font-weight: 500; margin-left: 2px; }
  .rb .lb { font-size: 11px; letter-spacing: 2px; color: ${riskInfo.color}; font-weight: 700; text-transform: uppercase; }

  .interp {
    background: ${riskInfo.bgColor};
    border: 1px solid ${riskInfo.color}55;
    border-radius: 10px;
    padding: 18px 22px;
    margin: 20px 0 8px;
  }
  .interp p { color: #e2e8f0; margin: 0; }

  /* Patient summary bullets — bordered rows with accent bar, matching the
     web version's look. Always visible (not hover-only). */
  .bullets { list-style: none; padding: 0; margin: 14px 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .bullets li {
    padding: 10px 14px;
    font-size: 13px;
    color: #cbd5e1;
    background: rgba(6,182,212,0.04);
    border: 1px solid rgba(6,182,212,0.18);
    border-radius: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
  }
  .bullets .bl { color: #94a3b8; }
  .bullets .bv { font-weight: 700; font-family: 'SF Mono', Menlo, monospace; white-space: nowrap; }

  table { width: 100%; border-collapse: collapse; margin: 14px 0 18px; font-size: 13px; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  th { background: #0f172a; color: #94a3b8; text-align: left; padding: 11px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; }
  td { padding: 11px 12px; border-bottom: 1px solid #1e3a5f; color: #cbd5e1; vertical-align: top; }
  td.reduction { color: #10b981; font-weight: 700; }

  .sev, .urg, .act {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid transparent;
  }
  /* Severity / urgency / action pill colors — kept in lockstep with
     'frontend/lib/severity.ts' so a record exported to PDF shows the same
     border colors as the on-screen card did. The 4-tier scale is
     green → amber → orange → red so HIGH and CRITICAL are visually
     distinct (previously both were red, which collapsed the top two
     tiers visually in both the UI and the PDF). */
  .sev-critical { color: #ff0040; border-color: #ff0040; background: rgba(255,0,64,0.10); }
  .sev-high     { color: #f97316; border-color: #f97316; background: rgba(249,115,22,0.10); }
  .sev-moderate { color: #f59e0b; border-color: #f59e0b; background: rgba(245,158,11,0.10); }
  .sev-low      { color: #10b981; border-color: #10b981; background: rgba(16,185,129,0.10); }
  .urg-immediate, .urg-high { color: #ef4444; border-color: #ef4444; background: rgba(239,68,68,0.08); }
  .urg-standard             { color: #06b6d4; border-color: #06b6d4; background: rgba(6,182,212,0.08); }
  .act-discontinue { color: #ef4444; border-color: #ef4444; background: rgba(239,68,68,0.08); }
  .act-substitute  { color: #06b6d4; border-color: #06b6d4; background: rgba(6,182,212,0.08); }
  .act-reduce      { color: #f59e0b; border-color: #f59e0b; background: rgba(245,158,11,0.08); }
  .act-monitor     { color: #10b981; border-color: #10b981; background: rgba(16,185,129,0.08); }

  .finding { padding: 10px 14px; background: rgba(239,68,68,0.06); border-left: 3px solid #ef4444; margin: 8px 0; border-radius: 0 6px 6px 0; color: #fca5a5; }
  .warn    { padding: 10px 14px; background: rgba(245,158,11,0.06); border-left: 3px solid #f59e0b; margin: 8px 0; border-radius: 0 6px 6px 0; color: #fbbf24; }

  .total-reduction { color: #10b981; font-weight: 700; font-size: 15px; margin-top: 12px; padding: 10px 14px; background: rgba(16,185,129,0.08); border-radius: 6px; }

  .ft { margin-top: 52px; padding-top: 24px; border-top: 1px solid #1e3a5f; font-size: 11px; color: #64748b; text-align: center; }
  .ft p { margin-bottom: 6px; }

  /* Print: near-black text, keep the score orange bold and the border blue
     thick. This is what the user specifically asked for in the PDF export. */
  @media print {
    body { background: #ffffff; color: #111827; padding: 0; }
    .c { max-width: 100%; }
    h1.title {
      /* Keep gradient visible on modern print engines that support it;
         fall back to a solid readable color if not. */
      color: #0369a1;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    h2 { color: #0369a1; border-bottom-color: #cbd5e1; }
    h3 { color: #475569; }
    p  { color: #111827; }
    .sub { color: #475569; }
    .hdr { border-bottom-color: #cbd5e1; }
    .rb {
      background: #ffffff;
      border: 3px solid #0369a1; /* thick blue border on paper */
      box-shadow: none;
    }
    .rb .sc { color: #ea580c; }        /* bold orange score */
    .rb .sc .denom { color: #94a3b8; }
    .rb .lb { color: #ea580c; }
    .interp { background: #fff7ed; border-color: #fed7aa; }
    .interp p { color: #111827; }
    .bullets li {
      color: #111827;
      background: #f8fafc;
      border-color: #cbd5e1;
    }
    .bullets .bl { color: #475569; }
    th { background: #f1f5f9; color: #334155; }
    td { color: #111827; border-bottom-color: #e5e7eb; }
    .finding { background: #fef2f2; color: #991b1b; }
    .warn { background: #fffbeb; color: #92400e; }
    .total-reduction { background: #ecfdf5; color: #065f46; }
    .ft { color: #475569; border-top-color: #e5e7eb; }
    /* Keep severity pills readable on paper */
    .sev, .urg, .act {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style>
</head>
<body>
<div class="c">

  <div class="hdr">
    <div class="meta">
      <h1 class="title">RxNexus Clinical Report</h1>
      <p class="sub">Patient-Specific Polypharmacy Intelligence</p>
      <p class="sub">${resolvedMedCount !== undefined ? `${resolvedMedCount} medications · ` : ""}${now}</p>
    </div>
    <div class="rb">
      <div class="sc">${numScore.toFixed(1)}<span class="denom">/10</span></div>
      <div class="lb">${esc(riskInfo.label)}</div>
    </div>
  </div>

  <div class="interp">
    <p><strong>Interpretation:</strong> ${esc(riskInfo.description)}</p>
  </div>

  ${modelNote}

  <h2>Patient Summary</h2>
  <p>${esc(summary.headline)}</p>
  ${summaryBullets}

  <h2>Phenotype Profile</h2>
  <table><thead><tr><th>Parameter</th><th>Value</th></tr></thead><tbody>${phenoRows}</tbody></table>

  ${(() => {
    // Mirror the placeholder detection used by the on-page RiskReport, so
    // the exported HTML/PDF never includes a useless "See full report
    // below" line when the agent didn't produce a real summary. Long real
    // summaries (≥30 chars) always pass through; short strings only pass
    // if they don't match any placeholder pattern.
    const s = (report?.interaction_summary ?? "").trim();
    if (!s) return "";
    const placeholders = ["see full report", "see report", "see below", "n/a", "none", "tbd"];
    const lower = s.toLowerCase();
    if (s.length < 30 && placeholders.some((p) => lower.includes(p))) return "";
    return `<h2>Interaction Summary</h2><p>${esc(s)}</p>`;
  })()}

  ${(report?.critical_findings ?? []).length > 0
    ? `<h2>Critical Findings</h2>${report!.critical_findings.map((f: string) => `<div class="finding">${esc(f)}</div>`).join("")}`
    : ""}

  ${interactionRowsFinal ? `
    <h2>Drug Interactions (${totalInteractions ?? 0})</h2>
    <p>${[
      graphNodeCount > 0 ? `${graphNodeCount} drugs` : "",
      resolvedGraph ? `${resolvedGraph.edges.length} pairwise interactions · Density ${((resolvedGraph.graph_density ?? 0) * 100).toFixed(0)}%` : "",
      criticalCount > 0 ? `${criticalCount} critical` : "",
      highCount > 0 ? `${highCount} high` : "",
      hubDrugs.length > 0 ? `Hub drugs: <strong>${esc(hubDrugs.join(", "))}</strong>` : "",
    ].filter(Boolean).join(" · ")}</p>
    <table>
      <thead><tr><th>Drugs</th><th>Severity</th><th>Mechanism / Description</th>${showEvidenceCols ? "<th>Evidence</th><th>Confidence</th>" : ""}</tr></thead>
      <tbody>${interactionRowsFinal}</tbody>
    </table>
    ${emergent.length > 0 ? `
      <h3>Emergent Multi-Drug Interactions</h3>
      ${emergent.map((e) => `<div class="warn">⚠ <strong>${esc((e.drugs ?? []).join(" + "))}</strong> — ${esc(e.description)} <em>(${esc(e.severity.toUpperCase())})</em></div>`).join("")}
    ` : ""}
  ` : ""}

  ${resolvedTemporal ? `
    <h2>Risk Cascade Timeline</h2>
    <p>${esc(resolvedTemporal.summary ?? "")}</p>
    <p><strong>Projection:</strong> ${resolvedTemporal.timeline_days ?? 0} model days &nbsp;·&nbsp;
       <strong>Peak modeled risk:</strong> <span style="color:#ea580c;font-weight:700">${peakScore.toFixed(1)}/10</span> · model day ${peakDay}
       <em style="color:#64748b;font-size:12px">&nbsp;(days are model units, not calendar dates)</em></p>
    ${windowRows ? `
      <h3>Intervention Windows</h3>
      <table>
        <thead><tr><th>Day Range</th><th>Action</th><th>Urgency</th></tr></thead>
        <tbody>${windowRows}</tbody>
      </table>
    ` : ""}
    ${keyEventRows ? `
      <h3>Key Events</h3>
      <table>
        <thead><tr><th>Day</th><th>Event</th><th>Risk Score</th></tr></thead>
        <tbody>${keyEventRows}</tbody>
      </table>
    ` : ""}
  ` : ""}

  ${resolvedDep && depRows ? `
    <h2>Deprescribing Plan</h2>
    <p>${esc(resolvedDep.summary ?? "")}</p>
    <table>
      <thead><tr><th>#</th><th>Drug</th><th>Action</th><th>Substitute</th><th>Risk ↓</th><th>Timeline</th><th>Rationale</th></tr></thead>
      <tbody>${depRows}</tbody>
    </table>
    <div class="total-reduction">Total expected risk reduction: -${resolvedDep.total_expected_risk_reduction ?? 0}%</div>
    ${(resolvedDep.warnings ?? []).length > 0
      ? `<h3>Clinical Warnings</h3>${resolvedDep.warnings.map((w) => `<div class="warn">⚠ ${esc(w)}</div>`).join("")}`
      : ""}
  ` : ""}

  ${/* Raw report payload (typically a JSON dump from the agent) is
       deliberately excluded from the HTML and PDF exports. Clinical end
       users find the JSON unreadable and it inflates the export with
       noise. The raw payload is still available in the web UI under the
       "Full Report (Raw)" section behind a "Show raw" toggle for
       developers and auditors who need to inspect it. */ ""}

  <div class="ft">
    <p><strong>RxNexus</strong> — Patient-Specific Polypharmacy Intelligence</p>
    <p style="max-width:640px;margin:8px auto">Decision-support only. AI-generated for informational purposes; review by a qualified healthcare professional is required.</p>
    <p style="max-width:640px;margin:4px auto">RxNexus is based on the open-source ARIA project by Wiqi Lee (MIT license) and is adapted for an educational/exhibition clinical decision-support prototype.</p>
    <p style="margin-top:8px">${now}</p>
  </div>

</div>
</body>
</html>`;
}

/** Minimal HTML escaper — prevents <script>-style content in drug names or
 *  user-entered comorbidities from breaking the report. */
function esc(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Interpretation Panels ───────────────────────────────

// ── Graph selection helpers (side panels + priority links) ──
function sevRankOf(s: string | undefined): number {
  const map: Record<string, number> = { low: 1, moderate: 2, high: 3, critical: 4 };
  return map[(s ?? "").toLowerCase()] ?? 0;
}
// Drug pairs are compared without order sensitivity so a priority item and
// a graph edge always match regardless of which drug listed first.
function sortedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}
function edgeMatchesPair(
  e: { source: string; target: string },
  pair: [string, string],
) {
  const p = sortedPair(e.source, e.target);
  const q = sortedPair(pair[0], pair[1]);
  return p[0] === q[0] && p[1] === q[1];
}
function drugsMatchPair(drugs: string[] | undefined, pair: [string, string]) {
  if (!Array.isArray(drugs) || drugs.length !== 2) return false;
  return edgeMatchesPair({ source: drugs[0], target: drugs[1] }, pair);
}
// Build the same rich payload the 3D component emits for a node, so the
// page can pin a node panel directly (e.g. from a priority/deprescribing
// link) without needing to click the actual mesh.
function buildGraphNodePayload(
  graph: InteractionGraph | null,
  name: string,
): NodeClickPayload | null {
  if (!graph) return null;
  const node = graph.nodes?.find((n) => n.drug_name === name);
  if (!node) return null;
  const sevRank: Record<Severity, number> = { low: 1, moderate: 2, high: 3, critical: 4 };
  const edges = graph.edges ?? [];
  const connected: NodeClickPayload["connected"] = [];
  let worst: Severity | null = null;
  for (const e of edges) {
    if (e.source === name || e.target === name) {
      const other = e.source === name ? e.target : e.source;
      connected.push({ drug: other, severity: e.severity, type: e.interaction_type });
      if (!worst || sevRank[e.severity] > sevRank[worst]) worst = e.severity;
    }
  }
  connected.sort((a, b) => sevRank[b.severity] - sevRank[a.severity]);
  return {
    drug_name: name,
    is_hub: node.is_hub,
    degree: node.degree ?? connected.length,
    hub_score: node.hub_score ?? 0,
    connected,
    worst_severity: worst,
  };
}

// ── Viz side panel helpers (shared by all 4 viz tabs) ────────
//
// Pattern: absolute-positioned panel anchored top-right of the canvas
// wrapper, with subtle border + glow in the viz's accent color. Unified
// here so all four tabs have identical chrome.

/** Renders OVER the 3D canvas wrapper when the active tab's dataset was not
 *  returned by the backend. Honest empty state — never synthesized data.
 *  MUST live outside <Canvas>: inside Canvas this <div> would be parsed as a
 *  THREE element and crash with "Div is not part of the THREE namespace!" */
function VizEmptyState({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
      <div
        className="text-xs leading-relaxed text-center max-w-[260px] px-4 py-3 rounded-lg"
        style={{ color: "#7a8ba8", background: "rgba(2,8,23,0.85)", border: "1px solid var(--border)" }}
      >
        {message}
      </div>
    </div>
  );
}

function VizSidePanel({
  accentColor,
  children,
  onClose,
}: {
  accentColor: string;
  children: React.ReactNode;
  /** If provided, shows a close (×) button that triggers it. Used for
   *  click-to-select viz (Graph, Deprescribing). Omit for hover-only viz
   *  (Phenotype, Timeline) where the panel disappears on pointer-out. */
  onClose?: () => void;
}) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 8 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        // On desktop the panel sits in the top-right corner with a fixed
        // 260px width. On mobile (< sm = 640px) the panel anchors to the
        // bottom of the canvas and spans the full width minus a small gutter,
        // so it doesn't cover the graph it's describing. The Tailwind utilities
        // here flip both the position and the sizing at the breakpoint.
        className="absolute left-3 right-3 bottom-3 sm:left-auto sm:right-3 sm:top-3 sm:bottom-auto rounded-lg p-3 w-auto sm:w-[260px]"
        style={{
          maxHeight: "calc(100% - 24px)",
          overflowY: "auto",
          background: "rgba(6,14,31,0.94)",
          backdropFilter: "blur(8px)",
          border: `1px solid ${accentColor}66`,
          boxShadow: `0 0 24px ${accentColor}26, 0 4px 20px rgba(0,0,0,0.5)`,
          zIndex: 10,
          pointerEvents: onClose ? "auto" : "none",
        }}
      >
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-1.5 right-1.5 w-5 h-5 rounded flex items-center justify-center transition-colors"
            style={{ color: "#7a8ba8", fontSize: 14, lineHeight: 1, background: "transparent" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#eaf0fa"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#7a8ba8"; }}
            aria-label="Close details"
          >
            ×
          </button>
        )}
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function SidePanelHeader({
  title,
  badge,
  accent,
}: {
  title: string;
  badge?: string;
  accent: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2 pr-5">
      <span
        className="font-display font-bold text-sm truncate"
        style={{ color: accent }}
      >
        {title}
      </span>
      {badge && (
        <span
          className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded tracking-wider shrink-0"
          style={{ color: accent, background: `${accent}22`, border: `1px solid ${accent}44` }}
        >
          {badge}
        </span>
      )}
    </div>
  );
}

function SidePanelScore({ value, accent }: { value: number; accent: string }) {
  return (
    <>
      <div className="flex items-baseline gap-1.5 mb-2">
        <span className="font-display font-bold text-2xl" style={{ color: accent }}>
          {value.toFixed(1)}
        </span>
        <span className="text-[11px] font-mono" style={{ color: "#7a8ba8" }}>/ 10</span>
      </div>
      <div className="h-1 rounded-full overflow-hidden mb-2.5" style={{ background: "rgba(30,58,95,0.5)" }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${Math.min(value * 10, 100)}%`,
            background: accent,
            boxShadow: `0 0 8px ${accent}80`,
          }}
        />
      </div>
    </>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div
      className="px-2 py-1 rounded text-[10px]"
      style={{
        background: accent ? `${accent}10` : "rgba(6,182,212,0.05)",
        border: `1px solid ${accent ? `${accent}33` : "rgba(6,182,212,0.1)"}`,
      }}
    >
      <div style={{ color: "#7a8ba8" }} className="uppercase tracking-wider">{label}</div>
      <div className="font-mono font-bold" style={{ color: accent ?? "#eaf0fa", fontSize: 12 }}>
        {String(value)}
      </div>
    </div>
  );
}

function InterpretPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.div
      className="p-4 rounded-xl text-xs space-y-2"
      initial={false}
      whileHover={{
        scale: 1.008,
        transition: { duration: 0.3 },
      }}
      style={{
        background: "rgba(8,20,37,0.6)",
        border: "1px solid rgba(0,229,255,0.07)",
        transition: "all 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.background = "rgba(6, 182, 212, 0.05)";
        el.style.borderColor = "rgba(6, 182, 212, 0.25)";
        el.style.boxShadow = "0 0 24px rgba(6, 182, 212, 0.08), inset 0 1px 0 rgba(6, 182, 212, 0.1)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.background = "rgba(8,20,37,0.6)";
        el.style.borderColor = "rgba(0,229,255,0.07)";
        el.style.boxShadow = "none";
      }}
    >
      <h4 className="font-display font-semibold uppercase tracking-wider"
        style={{ color: "var(--primary)", fontSize: 11 }}>{title}</h4>
      {children}
    </motion.div>
  );
}

// ── Unified Interpretation helpers ────────────────────────
//
// Goal: every Interpretation panel (Graph, Timeline, Phenotype, Deprescribing)
// looks the same — bordered stat boxes on top with hover color animation,
// soft-divider detail rows below. All info always visible (never hover-only).

/** Bordered key-value stat with hover color animation. */
function StatBox({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  /** Optional semantic color applied to the value + hover border. */
  accent?: string;
}) {
  const neutralBg = "rgba(6,182,212,0.04)";
  const neutralBorder = "rgba(6,182,212,0.1)";
  const accentBg = accent ? `${accent}11` : neutralBg;
  const accentBorder = accent ? `${accent}26` : neutralBorder;
  return (
    <div
      className="px-2 py-1.5 rounded transition-all"
      style={{
        background: accentBg,
        border: `1px solid ${accentBorder}`,
        transition: "background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease",
        cursor: "default",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = accent ?? "rgba(6,182,212,0.4)";
        el.style.boxShadow = `0 0 12px ${accent ? `${accent}33` : "rgba(6,182,212,0.15)"}`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = accentBorder;
        el.style.boxShadow = "none";
      }}
    >
      <span style={{ color: "#a3b8d0" }} className="text-xs">{label}:</span>{" "}
      <span className="font-mono font-bold text-xs" style={{ color: accent ?? "#f1f5f9" }}>
        {String(value)}
      </span>
    </div>
  );
}

/** Table-style detail row (used in all four Interpretation panels). */
function InfoRow({
  index,
  accentColor,
  labelContent,
  valueContent,
  onClick,
}: {
  index: number;
  accentColor: string;
  labelContent: React.ReactNode;
  valueContent: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2 text-xs"
      style={{
        borderTop: index === 0 ? "none" : "1px solid rgba(148,163,184,0.08)",
        background: "transparent",
        transition: "background-color 0.3s ease, box-shadow 0.3s ease",
        cursor: onClick ? "pointer" : "default",
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.background = `${accentColor}14`;
        el.style.boxShadow = `inset 3px 0 0 ${accentColor}88`;
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.background = "transparent";
        el.style.boxShadow = "none";
      }}
    >
      <div className="font-medium min-w-0">{labelContent}</div>
      <div className="text-right shrink-0">{valueContent}</div>
    </div>
  );
}

/** Detail-table shell with header row. */
function InfoTable({
  accent,
  headerLeft,
  headerRight,
  children,
}: {
  accent: string;
  headerLeft: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="mt-3 rounded-lg overflow-hidden"
      style={{
        border: `1px solid ${accent}2e`,
        background: "rgba(8,20,37,0.4)",
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{
          background: `${accent}19`,
          borderBottom: `1px solid ${accent}26`,
        }}
      >
        <p style={{ color: accent }} className="font-semibold text-xs">
          {headerLeft}
        </p>
        {headerRight && (
          <span className="text-[10px] uppercase tracking-wider font-mono" style={{ color: "#7a8ba8" }}>
            {headerRight}
          </span>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  // Legacy helper kept for any other callers. New Interpretation panels use StatBox.
  return (
    <span className="transition-colors duration-200">
      <span style={{ color: "#94a8c8" }}>{label}:</span>{" "}
      <span className="font-mono" style={color ? { color } : { color: "#eaf0fa" }}>{String(value)}</span>
    </span>
  );
}

function GraphInterpretation({ graph }: { graph: InteractionGraph | null }) {
  if (!graph) {
    return (
      <InterpretPanel title="Graph Interpretation">
        <p className="text-xs leading-relaxed" style={{ color: "#7a8ba8" }}>
          Interaction graph unavailable for this analysis.
        </p>
      </InterpretPanel>
    );
  }
  const edges = graph.edges ?? [];
  const nodes = graph.nodes ?? [];
  const hubs = graph.hub_drugs ?? [];
  const crit = edges.filter((e) => e.severity === "critical").length;
  const high = edges.filter((e) => e.severity === "high").length;
  const moderate = edges.filter((e) => e.severity === "moderate").length;
  const low = edges.filter((e) => e.severity === "low").length;
  const emergent = graph.emergent_interactions ?? [];

  // Top interactions ordered by severity
  const sevRank: Record<Severity, number> = { low: 1, moderate: 2, high: 3, critical: 4 };
  const topInteractions = [...edges]
    .sort((a, b) => sevRank[b.severity] - sevRank[a.severity])
    .slice(0, 6);

  return (
    <InterpretPanel title="Graph Interpretation">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        <StatBox label="Drugs" value={nodes.length} />
        <StatBox label="Interactions" value={edges.length} />
        <StatBox label="Density" value={`${((graph.graph_density ?? 0) * 100).toFixed(0)}%`} />
        <StatBox label="Critical" value={crit} accent={crit > 0 ? "#ff0040" : undefined} />
        <StatBox label="High" value={high} accent={high > 0 ? "#f97316" : undefined} />
        <StatBox label="Moderate" value={moderate} accent={moderate > 0 ? "#f59e0b" : undefined} />
        <StatBox label="Low" value={low} accent={low > 0 ? "#10b981" : undefined} />
        <StatBox label="Hub Drugs" value={hubs.length} accent={hubs.length > 0 ? "#7c4dff" : undefined} />
        <StatBox label="Emergent" value={emergent.length} accent={emergent.length > 0 ? "#f59e0b" : undefined} />
      </div>

      {topInteractions.length > 0 && (
        <InfoTable
          accent="#06b6d4"
          headerLeft={`Top ${topInteractions.length} interaction${topInteractions.length > 1 ? "s" : ""} by severity`}
          headerRight="pair · severity"
        >
          {topInteractions.map((e, i) => {
            const sevColor = SEVERITY_COLORS[e.severity] ?? "#94a8c8";
            return (
              <InfoRow
                key={i}
                index={i}
                accentColor={sevColor}
                labelContent={
                  <span className="font-medium" style={{ color: "#eaf0fa" }}>
                    {e.source} <span style={{ color: "#7a8ba8" }}>+</span> {e.target}
                  </span>
                }
                valueContent={
                  <span
                    className="text-[10px] uppercase tracking-wider font-mono font-bold px-1.5 py-0.5 rounded"
                    style={{ color: sevColor, background: `${sevColor}1c`, border: `1px solid ${sevColor}33` }}
                  >
                    {e.severity}
                  </span>
                }
              />
            );
          })}
        </InfoTable>
      )}

      {hubs.length > 0 && (
        <InfoTable accent="#7c4dff" headerLeft={`Hub drug${hubs.length > 1 ? "s" : ""} (high connectivity)`}>
          {hubs.map((h, i) => {
            const deg = nodes.find((n) => n.drug_name === h)?.degree ?? 0;
            return (
              <InfoRow
                key={i}
                index={i}
                accentColor="#7c4dff"
                labelContent={<span className="font-mono font-bold" style={{ color: "#a78bfa" }}>★ {h}</span>}
                valueContent={
                  <span className="font-mono text-xs" style={{ color: "#cbd5e1" }}>
                    {deg} connection{deg !== 1 ? "s" : ""}
                  </span>
                }
              />
            );
          })}
        </InfoTable>
      )}

      {emergent.length > 0 && (
        <InfoTable accent="#f59e0b" headerLeft={`⚠ ${emergent.length} emergent multi-drug interaction${emergent.length > 1 ? "s" : ""}`}>
          {emergent.map((ei, i) => (
            <InfoRow
              key={i}
              index={i}
              accentColor="#f59e0b"
              labelContent={
                <span className="font-medium" style={{ color: "#fbbf24" }}>
                  {(ei.drugs || []).join(" + ")}
                </span>
              }
              valueContent={
                <span
                  className="text-[10px] uppercase tracking-wider font-mono font-bold px-1.5 py-0.5 rounded"
                  style={{
                    color: SEVERITY_COLORS[ei.severity] ?? "#f59e0b",
                    background: `${SEVERITY_COLORS[ei.severity] ?? "#f59e0b"}1c`,
                    border: `1px solid ${SEVERITY_COLORS[ei.severity] ?? "#f59e0b"}33`,
                  }}
                >
                  {ei.severity}
                </span>
              }
            />
          ))}
        </InfoTable>
      )}
    </InterpretPanel>
  );
}

function TimelineInterpretation({ temporal }: { temporal: CascadeModel | null }) {
  if (!temporal) {
    return (
      <InterpretPanel title="Timeline Interpretation">
        <p className="text-xs leading-relaxed" style={{ color: "#7a8ba8" }}>
          No temporal cascade was returned for this analysis.
        </p>
      </InterpretPanel>
    );
  }
  const peakScore = temporal.peak_risk_score ?? 0;
  const peakColor =
    peakScore >= 8.5 ? "#ff0040" :
    peakScore >= 5.0 ? "#f97316" :
    peakScore >= 2.0 ? "#f59e0b" : "#06b6d4";
  const windows = temporal.intervention_windows ?? [];
  const daily = temporal.daily_risk ?? [];
  const avgRisk = daily.length > 0
    ? daily.reduce((sum, d) => sum + (d.risk_score ?? 0), 0) / daily.length
    : 0;
  // Key events extracted from daily_risk
  const keyEvents = daily.filter((d) => d.key_event);

  return (
    <InterpretPanel title="Timeline Interpretation">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        <StatBox label="Projection" value={`${temporal.timeline_days ?? 0} days`} />
        <StatBox label="Peak Day" value={`Day ${temporal.peak_risk_day ?? "?"}`} accent={peakColor} />
        <StatBox label="Peak Score" value={`${peakScore.toFixed(1)}/10`} accent={peakColor} />
        <StatBox label="Avg Risk" value={`${avgRisk.toFixed(1)}/10`} />
        <StatBox label="Interventions" value={windows.length} accent={windows.length > 0 ? "#06b6d4" : undefined} />
        <StatBox label="Key Events" value={keyEvents.length} />
      </div>

      {windows.length > 0 && (
        <InfoTable
          accent="#06b6d4"
          headerLeft={`Intervention window${windows.length > 1 ? "s" : ""}`}
          headerRight="day range · action"
        >
          {windows.map((w, i) => {
            const urgent = w.urgency === "high" || w.urgency === "immediate";
            const accent = urgent ? "#ef4444" : "#06b6d4";
            return (
              <InfoRow
                key={i}
                index={i}
                accentColor={accent}
                labelContent={
                  <span style={{ color: "#eaf0fa" }} className="font-medium">
                    <span style={{ color: accent }}>●</span>{" "}
                    {w.action}
                  </span>
                }
                valueContent={
                  <span className="font-mono text-xs" style={{ color: accent }}>
                    Day {w.day_start}–{w.day_end}
                  </span>
                }
              />
            );
          })}
        </InfoTable>
      )}

      {keyEvents.length > 0 && (
        <InfoTable
          accent="#f59e0b"
          headerLeft="Key events"
          headerRight="day · event"
        >
          {keyEvents.map((d, i) => (
            <InfoRow
              key={i}
              index={i}
              accentColor="#f59e0b"
              labelContent={
                <span style={{ color: "#eaf0fa" }} className="font-medium truncate block">
                  {d.key_event}
                </span>
              }
              valueContent={
                <span className="font-mono text-xs" style={{ color: "#fbbf24" }}>
                  Day {d.day} · {(d.risk_score ?? 0).toFixed(1)}/10
                </span>
              }
            />
          ))}
        </InfoTable>
      )}

      {temporal.summary && (
        <p
          className="text-xs mt-3 p-3 rounded-lg leading-relaxed"
          style={{
            color: "#cbd5e1",
            background: "rgba(6,182,212,0.05)",
            border: "1px solid rgba(6,182,212,0.12)",
          }}
        >
          {temporal.summary}
        </p>
      )}
    </InterpretPanel>
  );
}

function PhenotypeInterpretation({ request }: { request: AnalyzeRequest | null }) {
  const p = request?.patient;
  if (!p) return null;

  const riskFactors: { label: string; detail: string }[] = [];
  if ((p.age??0) > 65) riskFactors.push({ label: "Elderly (>65)", detail: "Increased ADR susceptibility" });
  if ((p.ckd_stage??0) >= 3) riskFactors.push({ label: `CKD Stage ${p.ckd_stage}`, detail: "Impaired renal clearance" });
  if (p.hepatic_impairment) riskFactors.push({ label: "Hepatic impairment", detail: "Altered metabolism" });
  if (p.smoking) riskFactors.push({ label: "Active smoker", detail: "CYP1A2 induction" });
  if (p.sex === "female") riskFactors.push({ label: "Female", detail: "Higher QT baseline risk" });

  const phenoStats: { label: string; value: string | number; accent?: string }[] = [
    { label: "Age", value: p.age ?? 0, accent: (p.age ?? 0) > 65 ? "#f59e0b" : undefined },
    { label: "Sex", value: p.sex ?? "unknown" },
    { label: "CKD Stage", value: p.ckd_stage ?? 0, accent: (p.ckd_stage ?? 0) >= 3 ? "#ef4444" : undefined },
    { label: "Hepatic", value: p.hepatic_impairment ? "Impaired" : "Normal", accent: p.hepatic_impairment ? "#ef4444" : "#10b981" },
    { label: "Smoking", value: p.smoking ? "Active" : "No", accent: p.smoking ? "#f59e0b" : undefined },
    { label: "Weight", value: p.weight_kg ? `${p.weight_kg} kg` : "N/A" },
  ];

  return (
    <InterpretPanel title="Phenotype Interpretation">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {phenoStats.map((s, i) => (
          <StatBox key={i} label={s.label} value={s.value} accent={s.accent} />
        ))}
      </div>

      {riskFactors.length > 0 && (
        <InfoTable
          accent="#f59e0b"
          headerLeft={`⚠ ${riskFactors.length} elevated risk factor${riskFactors.length > 1 ? "s" : ""}`}
          headerRight="factor · impact"
        >
          {riskFactors.map((r, i) => (
            <InfoRow
              key={i}
              index={i}
              accentColor="#f59e0b"
              labelContent={<span style={{ color: "#fbbf24" }} className="font-medium">{r.label}</span>}
              valueContent={<span style={{ color: "#cbd5e1" }}>{r.detail}</span>}
            />
          ))}
        </InfoTable>
      )}

      {riskFactors.length === 0 && (
        <p className="text-xs mt-3 p-3 rounded-lg"
          style={{
            color: "#10b981",
            background: "rgba(16,185,129,0.06)",
            border: "1px solid rgba(16,185,129,0.15)",
          }}>
          ✓ No elevated phenotype risk factors identified.
        </p>
      )}
    </InterpretPanel>
  );
}

function DeprescribingInterpretation({ plan }: { plan: DeprescribingPlan | null }) {
  if (!plan) return null;
  const steps = plan.steps ?? [];
  const actionColor = (a: string) =>
    a === "discontinue" ? "#ef4444"
      : a === "substitute" ? "#06b6d4"
      : a === "reduce" ? "#f59e0b"
      : "#10b981";

  const countBy = (action: string) => steps.filter((s) => s.action === action).length;
  const totalReduction = plan.total_expected_risk_reduction ?? 0;
  const warningCount = (plan.warnings ?? []).length;

  return (
    <InterpretPanel title="Deprescribing Interpretation">
      {/* Hero callout — the single most important number in this panel is
          the total expected risk reduction. Pulling it out into its own
          full-width card with a green gradient + ring icon makes the panel
          feel like a *plan* rather than a debug table, which is what the
          UI was reading as before (all stats in the same gray grid). */}
      {steps.length > 0 && (
        <div
          className="relative overflow-hidden rounded-lg p-3 mb-2"
          style={{
            background: "linear-gradient(135deg, rgba(16,185,129,0.18) 0%, rgba(6,182,212,0.08) 100%)",
            border: "1px solid rgba(16,185,129,0.35)",
            boxShadow: "0 0 24px rgba(16,185,129,0.12), inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest font-semibold mb-0.5"
                   style={{ color: "#86efac", letterSpacing: "0.16em" }}>
                Projected impact
              </div>
              <div className="font-display font-bold text-lg leading-tight" style={{ color: "#ecfdf5" }}>
                {steps.length}-step plan · −{totalReduction}% risk
              </div>
            </div>
            <div
              className="font-display font-bold shrink-0 text-2xl"
              style={{
                color: "#10b981",
                textShadow: "0 0 16px rgba(16,185,129,0.55)",
              }}
            >
              −{totalReduction}%
            </div>
          </div>
        </div>
      )}

      {/* Action breakdown — 3 colored chips, each only highlighting when its
          count > 0 so an action-less plan stays quiet. Brighter labels than
          the old StatBox grid because Steps / Total Reduction / Warnings
          were getting lost in low-contrast gray. */}
      <div className="grid grid-cols-3 gap-1.5">
        <StatBox
          label={getActionLabel("discontinue")}
          value={countBy("discontinue")}
          accent={countBy("discontinue") > 0 ? "#ef4444" : undefined}
        />
        <StatBox
          label={getActionLabel("substitute")}
          value={countBy("substitute")}
          accent={countBy("substitute") > 0 ? "#06b6d4" : undefined}
        />
        <StatBox
          label={getActionLabel("reduce")}
          value={countBy("reduce")}
          accent={countBy("reduce") > 0 ? "#f59e0b" : undefined}
        />
      </div>

      {steps.length > 0 && (
        <InfoTable
          accent="#06b6d4"
          headerLeft="Prescribed steps"
          headerRight="drug · action · reduction"
        >
          {steps.map((s, i) => {
            const ac = actionColor(s.action);
            return (
              <InfoRow
                key={i}
                index={i}
                accentColor={ac}
                labelContent={
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-bold shrink-0" style={{ color: ac }}>#{s.priority}</span>
                    <span style={{ color: "#f1f5f9" }} className="font-semibold truncate">{s.drug}</span>
                    {s.substitute && (
                      <>
                        <span style={{ color: "#06b6d4" }} className="text-[11px] shrink-0 font-mono">→</span>
                        <span style={{ color: "#7dd3fc" }} className="text-[11px] truncate font-medium">
                          {s.substitute}
                        </span>
                      </>
                    )}
                  </div>
                }
                valueContent={
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] uppercase tracking-wider font-mono font-bold px-1.5 py-0.5 rounded"
                      style={{
                        color: ac,
                        background: `${ac}1c`,
                        border: `1px solid ${ac}55`,
                      }}
                    >
                      {getActionLabel(s.action)}
                    </span>
                    <span className="font-mono font-bold text-xs" style={{ color: "#10b981" }}>
                      −{s.expected_risk_reduction}%
                    </span>
                  </div>
                }
              />
            );
          })}
        </InfoTable>
      )}

      {plan.summary && (
        <p
          className="text-xs mt-3 p-3 rounded-lg leading-relaxed"
          style={{
            color: "#e2e8f0",
            background: "rgba(6,182,212,0.06)",
            border: "1px solid rgba(6,182,212,0.22)",
          }}
        >
          {plan.summary}
        </p>
      )}

      {warningCount > 0 && (
        <InfoTable
          accent="#f59e0b"
          headerLeft={`⚠ Clinical warning${warningCount > 1 ? "s" : ""}`}
        >
          {plan.warnings!.map((w, i) => (
            <InfoRow
              key={i}
              index={i}
              accentColor="#f59e0b"
              labelContent={<span style={{ color: "#fcd34d" }} className="font-medium">{w}</span>}
              valueContent={<span />}
            />
          ))}
        </InfoTable>
      )}
    </InterpretPanel>
  );
}

// ── Hover Card wrapper ──────────────────────────────────
function HoverCard({
  children,
  borderColor,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  borderColor?: string;
  className?: string;
  delay?: number;
}) {
  const defaultBorder = borderColor ? `${borderColor}33` : "rgba(0,229,255,0.07)";
  const hoverBorderColor = borderColor ?? "#00e5ff";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className={`rounded-xl p-5 ${className}`}
      style={{
        background: "rgba(8,20,37,0.6)",
        border: `1px solid ${defaultBorder}`,
        transition: "all 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = `${hoverBorderColor}55`;
        el.style.boxShadow = `0 0 28px ${hoverBorderColor}18, 0 0 8px ${hoverBorderColor}10`;
        el.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = defaultBorder;
        el.style.boxShadow = "none";
        el.style.transform = "translateY(0)";
      }}
    >
      {children}
    </motion.div>
  );
}


// ════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════

export default function ReportPage() {
  const router = useRouter();
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [request, setRequest] = useState<AnalyzeRequest | null>(null);
  const [snapshotSource, setSnapshotSource] = useState<ReportSnapshotSource | null>(null);
  const [activeViz, setActiveViz] = useState<"graph" | "temporal" | "radar" | "waterfall">("graph");
  // Holds the currently-hovered radar axis so we can render an HTML tooltip
  // overlay (anchored on the right of the canvas, never clipped).
  const [radarHover, setRadarHover] = useState<RadarHoverPayload | null>(null);
  // Click/hover state for the 3 other visualizations. Each viz has its own
  // HTML side-panel overlay (pattern lifted from the Phenotype fix).
  const [graphHover, setGraphHover] = useState<NodeClickPayload | null>(null);
  const [timelineHover, setTimelineHover] = useState<TimelineHoverPayload | null>(null);
  const [deprescribingClick, setDeprescribingClick] = useState<DeprescribingClickPayload | null>(null);
  // Pinned node/edge selections (click-to-inspect). Hover still wins while
  // nothing is pinned; once pinned, the panel sticks until dismissed.
  const [graphNodeSel, setGraphNodeSel] = useState<NodeClickPayload | null>(null);
  const [graphEdgeSel, setGraphEdgeSel] = useState<{ source: string; target: string } | null>(null);

  useEffect(() => {
    // Read the single versioned analysis snapshot. `readSnapshot` also
    // invalidates: a stale/malformed snapshot and the pre-fix legacy keys
    // (`rxnexus-result` / `rxnexus-request`) are ignored and removed, so an
    // old report can never silently survive into a new session.
    const snap = readSnapshot(sessionStorage);
    if (snap) {
      setData(snap.result);
      setRequest(snap.request);
      setSnapshotSource(snap.source);
    } else {
      setData(null);
      setRequest(null);
      setSnapshotSource(null);
    }
  }, []);

  // Clear any sticky overlay state whenever the user switches tabs, so a
  // panel from one viz doesn't linger on another.
  useEffect(() => {
    if (activeViz !== "radar") setRadarHover(null);
    if (activeViz !== "graph") {
      setGraphHover(null);
      setGraphNodeSel(null);
      setGraphEdgeSel(null);
    }
    if (activeViz !== "temporal") setTimelineHover(null);
    if (activeViz !== "waterfall") setDeprescribingClick(null);
  }, [activeViz]);

  // Track viewport width so we can adapt 3D canvas heights and the side
  // panel layout to mobile screens. Detected via matchMedia on mount and
  // updated on resize. SSR fallback is desktop (false) to avoid hydration
  // mismatch flash on desktop users.
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobileViewport(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // STRICT single-source-of-truth: every visualization renders ONLY data
  // that actually came back from the analyze backend for the active
  // snapshot. Empty backend sections resolve to null (never demo
  // substitutes), and unavailable sections surface an honest "no data"
  // state instead of fabricated content.
  const effectiveGraph = useMemo((): InteractionGraph | null => resolveRealGraph(data), [data]);

  const effectiveTemporal = useMemo((): CascadeModel | null => resolveRealTemporal(data), [data]);

  const effectiveDeprescribing = useMemo((): DeprescribingPlan | null => {
    // REAL results only: when the backend returned zero deprescribing
    // steps, the plan is null — never substituted with synthetic/demo
    // recommendations. Absence of steps means "none returned", which the
    // UI surfaces neutrally rather than as a promise of safety.
    return resolveRealDeprescribing(data);
  }, [data]);

  // Re-baseline the active viz + clear sticky selections whenever the
  // availability of a visualization changes. The active tab can never be
  // one whose data is missing (dead tabs are disabled in the UI), so when a
  // section is unavailable we fall back to the first available tab — never
  // to a synthetic dataset.
  useEffect(() => {
    // Re-baseline the active viz whenever availability changes: the active
    // tab can never be one whose data is missing. Phenotype (radar) is
    // always available, so there is ALWAYS a valid target — this guarantees
    // the canvas never sits on a data-less tab.
    const available = ([
      { key: "graph", available: !!effectiveGraph },
      { key: "temporal", available: !!effectiveTemporal },
      { key: "radar", available: true },
      { key: "waterfall", available: !!effectiveDeprescribing },
    ] as const)
      .filter((t) => t.available)
      .map((t) => t.key);
    if (!(available as readonly string[]).includes(activeViz)) {
      setActiveViz(available[0]);
    }
  }, [activeViz, effectiveGraph, effectiveTemporal, effectiveDeprescribing]);

  const handleExportPDF = useCallback(() => {
    if (!data) return;
    const html = generateReportHTML(data, request);
    const w = window.open("", "_blank");
    if (!w) return; w.document.write(html); w.document.close();
    setTimeout(() => w.print(), 500);
  }, [data, request]);

  const handleExportHTML = useCallback(() => {
    if (!data) return;
    const html = generateReportHTML(data, request);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `RxNexus-Report-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [data, request]);

  const handleViewHTML = useCallback(() => {
    if (!data) return;
    const html = generateReportHTML(data, request);
    window.open(URL.createObjectURL(new Blob([html], { type: "text/html" })), "_blank");
  }, [data, request]);

  if (!data) {
    return (
      <><GridBackground /><div className="min-h-screen pt-24 flex items-center justify-center relative">
        <div className="fixed inset-0 z-0 pointer-events-none opacity-25">
          <Scene camera={{ position: [0, 0, 6], fov: 60 }}><FloatingParticles count={80} spread={12} /></Scene>
        </div>
        <div className="relative z-10 text-center">
          <div className="text-5xl mb-6">📋</div>
          <h2 className="font-display font-bold text-2xl text-gradient mb-3">No Report Available</h2>
          <p style={{ color: "#94a8c8" }} className="mb-6 max-w-sm mx-auto">Run an analysis first to generate a clinical report.</p>
          <button onClick={() => router.push("/analyze")} className="btn-primary">Start Analysis</button>
        </div>
      </div></>
    );
  }

  if (snapshotSource === "pre_generated_synthetic" && request) {
    return <><GridBackground /><PreGeneratedDemoReport request={request} result={data} /></>;
  }

  const errors = data.errors ?? [];
  // Medication count resolved from real backend sources only. May be
  // undefined when no source exists — callers must omit the count then,
  // never display a fabricated 0.
  const medCount = resolveMedicationCount(data, effectiveGraph, request);
  // Compute numScore first, then derive everything (label, color, scale-
  // reference highlight) from it. We DELIBERATELY ignore the LLM-emitted
  // `overall_risk_level` string here: that field has been observed to
  // disagree with the numeric score (e.g. score 8.6 labelled "MODERATE"),
  // and the report layer should never show such a contradiction. The
  // Python agent already overrides `overall_risk_level` to match the
  // numeric score, but we double-check here so the UI is self-consistent
  // even if a future regression sneaks past the agent.
  const numScore = getNumericRiskScore(data, effectiveGraph, request);
  const riskInfo = getRiskLevelFromScore(numScore);
  const patientCtx = request?.patient || {
    age: 50, sex: "unknown", ckd_stage: 0, hepatic_impairment: false,
    smoking: false, alcohol_use: "none", comorbidities: [], allergies: [],
  };

  // Total interactions = pairwise (graph edges) + emergent multi-drug, so
  // the Patient Summary card matches the "Detected Interactions (N)"
  // header and the "Interaction Summary" sentence. Previously the card
  // counted only graph edges, which excluded emergent multi-drug
  // interactions and produced an inconsistent "4" on the card while the
  // rest of the page said "7". Use the same priority as the HTML export:
  // raw_interactions.total_interactions → raw_interactions.interactions
  // length → effectiveGraph.edges length.
  const totalInteractions = resolveInteractionTotals(data).total;
  const summaryTotals = resolveInteractionTotals(data);

  const vizTabs = [
    { key: "graph" as const, label: "Interaction Graph", icon: "🕸️", available: !!effectiveGraph },
    { key: "temporal" as const, label: "Risk Cascade", icon: "⏱️", available: !!effectiveTemporal },
    { key: "radar" as const, label: "Phenotype", icon: "👤", available: true },
    { key: "waterfall" as const, label: "Deprescribing", icon: "💊", available: !!effectiveDeprescribing },
  ];

  // Canvas height is responsive: on desktop the side panel sits in the
  // top-right corner so we use the original heights. On mobile the panel
  // anchors to the bottom of the canvas, so we add extra height to give
  // the 3D viz room above the panel without it being squashed.
  const canvasHeight = activeViz === "radar"
    ? (isMobileViewport ? 600 : 520)
    : (isMobileViewport ? 500 : 420);

  // Build structured patient summary. If the backend provides a
  // pre-written summary string, use it as the headline and leave bullets
  // empty; otherwise compute both from the request + viz data.
  const patientSummary: PatientSummaryData = data.report?.patient_summary
    ? { headline: data.report.patient_summary, bullets: [] }
    : buildPatientSummary(patientCtx, data, effectiveGraph, effectiveTemporal, effectiveDeprescribing, request);

  // ── Clinical Overview + Review Priorities (dashboard lead-in) ──────────
  // Backed exclusively by fields the backend returns in the response.
  // Severity splits are presentation-level counts from returned arrays;
  // nothing here invents a metric the backend does not expose.
  const hubName = effectiveGraph?.hub_drugs?.[0];
  const hubNode = effectiveGraph?.nodes?.find((n) => n.drug_name === hubName);
  // The pinned node panel wins over hover once the user clicks a node; hover
  // keeps the transient feel until something is intentionally selected.
  const activeGraphNode = graphNodeSel ?? graphHover;
  const renalAssessment = data.report?.renal_assessment;
  const renalSummary = renalAssessment
    ? {
        flagged: Array.isArray(renalAssessment.flagged) ? renalAssessment.flagged.length : 0,
        egfrRange: renalAssessment.estimated_egfr_range || undefined,
        ckdStage: typeof renalAssessment.ckd_stage === "number" ? renalAssessment.ckd_stage : undefined,
      }
    : undefined;

  // Prefer raw_interactions (has full descriptions + evidence metadata);
  // fall back to graph edges so the split still matches a rendered graph.
  const rawInteractionList = data.raw_interactions?.interactions ?? [];
  const severityPool: string[] =
    rawInteractionList.length > 0
      ? rawInteractionList.map((ix) => (ix.severity ?? "").toLowerCase())
      : (effectiveGraph?.edges ?? []).map((e) => (e.severity ?? "").toLowerCase());
  const criticalCount = severityPool.filter((s) => s === "critical").length;
  const highCount = severityPool.filter((s) => s === "high").length;

  // Priority items: critical/high interaction pairs first, then
  // deprescribing steps, capped at five — top of dashboard.
  const buildPriorityItems = (): ReviewPriorityItem[] => {
    const items: ReviewPriorityItem[] = [];
    const highInteractions = rawInteractionList.filter((ix) => {
      const s = (ix.severity ?? "").toLowerCase();
      return s === "critical" || s === "high";
    });
    for (const ix of highInteractions) {
      if (items.length >= 5) break;
      const s = (ix.severity ?? "").toLowerCase();
      items.push({
        id: ix.id ?? `ix-${items.length}`,
        title: (ix.drugs ?? []).join(" + ") || "Interaction",
        badge: s,
        badgeColor: SEVERITY_COLORS[s] ?? "#94a8c8",
        description:
          ix.description ||
          ix.mechanism ||
          "Potential interaction flagged for clinical review.",
        drugs: ix.drugs ?? [],
        actionLabel:
          ix.evidence_grade || ix.confidence_score != null
            ? "Evidence-graded interaction"
            : "Clinical review recommended",
        evidence:
          ix.confidence_score != null
            ? `Confidence ${ix.confidence_score}%`
            : ix.evidence_grade
              ? `Evidence: ${ix.evidence_grade}`
              : undefined,
      });
    }
    if (items.length < 5) {
      const steps = Array.isArray(effectiveDeprescribing?.steps)
        ? [...effectiveDeprescribing.steps].sort((a, b) => a.priority - b.priority)
        : [];
      for (const step of steps) {
        if (items.length >= 5) break;
        items.push({
          id: `step-${step.drug}`,
          title: step.drug,
          badge: `Priority ${step.priority}`,
          badgeColor: "#a78bfa",
          description: step.rationale || "Review flagged for clinical assessment.",
          drugs: [step.drug],
          actionLabel: getActionLabel(step.action),
          evidence:
            typeof step.expected_risk_reduction === "number"
              ? `~${step.expected_risk_reduction}% potential risk reduction`
              : undefined,
          timeline: step.timeline,
        });
      }
    }
    return items;
  };
  const priorityItems = buildPriorityItems();

  // Phase 7: clicking a review-priority item jumps to the graph and pins the
  // matching edge (interaction pairs) or node (single drug / deprescribing
  // step). Falls back silently when the drug isn't present in the graph.
  const selectPriority = (drugs: string[]) => {
    setActiveViz("graph");
    if (drugs.length >= 2) {
      const pair: [string, string] = [drugs[0], drugs[1]];
      const edge = (effectiveGraph?.edges ?? []).find((e) => edgeMatchesPair(e, pair));
      if (edge) {
        setGraphEdgeSel({ source: edge.source, target: edge.target });
        setGraphNodeSel(null);
        requestAnimationFrame(() => {
          document.getElementById("viz-anchor")?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        return;
      }
    }
    const name = drugs[0];
    setGraphEdgeSel(null);
    setGraphNodeSel(buildGraphNodePayload(effectiveGraph, name));
    requestAnimationFrame(() => {
      document.getElementById("viz-anchor")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  // Patient / Regimen Summary card — hoisted into a variable so it can be
  // rendered as the FIRST report section (before Clinical Overview → Review
  // Priorities → 3D graph + details). Age/sex/context come from the existing
  // request state; medication count uses the real-source resolver and is
  // omitted when unavailable (never a fabricated 0).
  const regimenNames = extractDrugNames(request).map(titleCase);
  const patientSummaryCard = (
    <HoverCard delay={0.2}>
      <h3 className="font-display font-semibold text-xs uppercase tracking-wider mb-3" style={{ color: "var(--primary)" }}>Patient / Regimen Summary</h3>
      <div className="flex flex-col items-center sm:flex-row sm:items-stretch gap-4">
        <div className="w-32 sm:w-28 flex-shrink-0 rounded-lg overflow-hidden aspect-[3/4] sm:aspect-auto sm:self-stretch sm:min-h-[220px]" style={{ border: "1px solid rgba(6,182,212,0.25)", background: "rgba(2,8,23,0.9)" }}>
          <Scene camera={{ position: [0, 0, 3.5], fov: 45 }}>
            <PatientAvatar3D sex={(patientCtx as any).sex || "unknown"} />
          </Scene>
        </div>
        <div className="w-full sm:flex-1 sm:min-w-0 flex flex-col">
          <p className="text-sm leading-relaxed mb-2.5" style={{ color: "#eaf0fa" }}>
            {patientSummary.headline}
          </p>
          {medCount !== undefined && (
            <p className="text-[11px] mb-2.5 font-mono" style={{ color: "#7a8ba8" }}>
              {medCount} medications analyzed
            </p>
          )}
          {regimenNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {regimenNames.map((name) => (
                <span
                  key={name}
                  className="text-[10px] font-mono px-2 py-0.5 rounded"
                  style={{ background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.25)", color: "#a5d8ff" }}
                >
                  {name}
                </span>
              ))}
            </div>
          )}
          {patientSummary.bullets.length > 0 && (
            <div className="space-y-1.5 mb-2 flex-1">
              {patientSummary.bullets.map((b, i) => {
                const c = b.color ?? "#06b6d4";
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 text-[11px] px-2.5 py-1.5 rounded-md"
                    style={{
                      background: `${c}0c`,
                      border: `1px solid ${c}26`,
                      transition: "background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease",
                      cursor: "default",
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget;
                      el.style.background = `${c}1f`;
                      el.style.borderColor = `${c}66`;
                      el.style.boxShadow = `0 0 10px ${c}33`;
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget;
                      el.style.background = `${c}0c`;
                      el.style.borderColor = `${c}26`;
                      el.style.boxShadow = "none";
                    }}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="shrink-0" style={{ color: c }}>●</span>
                      <span className="truncate" style={{ color: "#94a8c8" }}>{b.label}</span>
                    </span>
                    <span className="font-mono font-bold shrink-0" style={{ color: c }}>
                      {b.value}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5 text-[10px]">
            {[
              { label: "Interactions", value: totalInteractions ?? "—", bg: "rgba(6,182,212,0.06)", border: "rgba(6,182,212,0.15)", color: "#eaf0fa", hoverBg: "rgba(6,182,212,0.12)" },
              { label: "Regimen Risk", value: `${numScore.toFixed(1)}/10`, bg: riskInfo.bgColor, border: `${riskInfo.color}22`, color: riskInfo.color, hoverBg: `${riskInfo.color}18` },
              { label: "Critical interactions", value: summaryTotals.critical ?? "—", bg: "rgba(255,0,64,0.06)", border: "rgba(255,0,64,0.18)", color: "#ff0040", hoverBg: "rgba(255,0,64,0.14)" },
              { label: "Deprescribing", value: effectiveDeprescribing ? `${(effectiveDeprescribing.steps ?? []).length} steps` : "—", bg: "rgba(16,185,129,0.06)", border: "rgba(16,185,129,0.15)", color: "#10b981", hoverBg: "rgba(16,185,129,0.12)" },
            ].map((stat, i) => (
              <div key={i} className="px-2 py-1 rounded"
                style={{
                  background: stat.bg,
                  border: `1px solid ${stat.border}`,
                  transition: "all 0.3s ease",
                  cursor: "default",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = stat.hoverBg;
                  e.currentTarget.style.boxShadow = `0 0 12px ${stat.border}`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = stat.bg;
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <span style={{ color: "#8a9bba" }}>{stat.label}:</span>{" "}
                <span className="font-mono font-bold" style={{ color: stat.color }}>{stat.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </HoverCard>
  );

  return (
    <><GridBackground /><DataStream position="top-right" /><DataStream position="bottom-left" lines={5} />
    <div className="min-h-screen pt-24 pb-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full" style={{ background: "var(--success)", boxShadow: "0 0 8px var(--success)" }} />
              <span className="text-xs tracking-widest uppercase" style={{ fontFamily: "var(--font-display)", color: "var(--success)" }}>Analysis Complete</span>
            </div>
            <h1 className="font-display font-bold text-3xl sm:text-4xl text-gradient mb-1">Clinical Report</h1>
            <p style={{ color: "#7a8ba8" }} className="text-sm">{medCount !== undefined && <>{medCount} medications analyzed · </>}{formatJakartaTime()}{errors.length > 0 && <span className="ml-2" style={{ color: "var(--warning)" }}>({errors.length} warning{errors.length !== 1 ? "s" : ""})</span>}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {[
              { onClick: handleExportPDF, icon: "📄", label: "Export PDF" },
              { onClick: handleExportHTML, icon: "💾", label: "Download HTML" },
              { onClick: handleViewHTML, icon: "🔗", label: "View Report" },
              { onClick: () => router.push("/analyze"), icon: "", label: "New Analysis" },
            ].map((btn, i) => (
              <button
                key={i}
                onClick={btn.onClick}
                className="btn-secondary text-xs flex items-center gap-1.5"
                style={{ transition: "all 0.3s ease" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(0,229,255,0.12)";
                  e.currentTarget.style.borderColor = "#00e5ff";
                  e.currentTarget.style.boxShadow = "0 0 20px rgba(0,229,255,0.15)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "rgba(0,229,255,0.22)";
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {btn.icon && <span>{btn.icon}</span>}{btn.label}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Decision-support notice */}
        <div
          className="rounded-lg px-4 py-3 mb-6 text-xs leading-relaxed"
          style={{
            background: "rgba(6, 182, 212, 0.05)",
            border: "1px solid rgba(6, 182, 212, 0.15)",
            color: "#a3b8d0",
          }}
        >
          <span className="font-semibold" style={{ color: "#00e5ff" }}>
            Decision support only.
          </span>{" "}
          RxNexus provides clinical decision support only. Recommendations
          require review by a qualified healthcare professional and should
          not be used as autonomous prescribing instructions.
        </div>

        {/* ── Report hierarchy: Patient / Regimen Summary leads, then
            Clinical Overview, then Review Priorities, then the 3D
            visualization + full details. ── */}
        {patientSummaryCard}

        <ClinicalOverview
          score={numScore}
          riskInfo={riskInfo}
          medications={medCount}
          interactions={
            totalInteractions !== undefined
              ? {
                  count: totalInteractions,
                  critical: summaryTotals.critical ?? 0,
                  high: summaryTotals.high ?? 0,
                }
              : undefined
          }
          hub={
            hubName && effectiveGraph
              ? {
                  drug: hubName,
                  degree: hubNode?.degree ?? 0,
                  hubScore: hubNode?.hub_score ?? 0,
                  isHub: hubNode?.is_hub ?? false,
                }
              : undefined
          }
          renal={renalSummary}
          burden={data.report?.burden_scores}
        />

        <ClinicalReviewPriorities
          items={priorityItems}
          onSelectInteraction={selectPriority}
        />

        {data.raw_interactions?.structured_source_status === "unavailable" && (
          <div
            className="rounded-xl px-4 py-3 text-sm"
            style={{
              color: "#f8d477",
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.28)",
            }}
          >
            <div className="font-semibold">Structured interaction source unavailable</div>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: "#c9b98d" }}>
              No source-supported interaction count or graph is shown. The {data.raw_interactions.review_concern_count ?? data.raw_interactions.interactions.length} item(s) below are AI-identified review concerns and require clinical verification; they are not deterministic database matches.
            </p>
          </div>
        )}

        {/* ── Main grid: stack on mobile, side-by-side on desktop ──
            On desktop the left column (3D viz + interpretation panel) is
            much shorter than the right column (overall risk + patient
            summary + the long RiskReport listing every interaction,
            deprescribing step, citation, etc). Plain `grid grid-cols-5`
            leaves a huge empty gap below the left column. Making the left
            column `sticky` with `self-start` keeps it pinned to the top of
            the viewport while the user scrolls through the report on the
            right — no dead space, and the 3D context stays visible while
            reading the detailed findings. We deliberately do NOT add
            overflow-y to the sticky container because it would steal scroll
            events from the 3D canvas's OrbitControls zoom. */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
          {/* Left — 3D */}
          <div className="lg:col-span-3 space-y-4 lg:sticky lg:top-4 lg:self-start">
            {/* Graph header: context + stats + legend so the 3D scene reads
                at a glance. Honest counts only — every number below comes
                from the returned graph or severity split, never inferred. */}
            {activeViz === "graph" && effectiveGraph && (
              <div
                className="rounded-xl p-3.5"
                style={{ background: "rgba(8,20,37,0.6)", border: "1px solid var(--border)" }}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="font-display font-semibold text-sm flex items-center gap-2 flex-wrap" style={{ color: "var(--text)" }}>
                      Interaction Graph
                      {(graphEdgeSel || graphNodeSel) && (
                        <span
                          className="font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 rounded"
                          style={{
                            color: "#06b6d4",
                            background: "rgba(0,229,255,0.08)",
                            border: "1px solid rgba(0,229,255,0.2)",
                          }}
                        >
                          ↦ linked from review priorities
                        </span>
                      )}
                    </h3>
                    <p className="text-[11px] mt-0.5" style={{ color: "#7a8ba8" }}>
                      Medication interaction network. <span style={{ color: "#a78bfa" }}>★</span> marks a
                      hub — a drug connected to multiple others. Line color = severity.
                    </p>
                  </div>
                  <span
                    className="font-mono text-[10px] px-2 py-1 rounded shrink-0"
                    style={{ color: "#7a8ba8", background: "rgba(2,8,23,0.5)", border: "1px solid rgba(0,229,255,0.1)" }}
                  >
                    Drag to rotate · Scroll to zoom
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5 mt-3">
                  <MiniStat label="Medications" value={effectiveGraph.nodes?.length ?? 0} accent="#06b6d4" />
                  <MiniStat label="Interactions" value={effectiveGraph.edges?.length ?? 0} accent="#06b6d4" />
                  <MiniStat label="Critical interactions" value={summaryTotals.critical ?? 0} accent={(summaryTotals.critical ?? 0) > 0 ? "#ff0040" : undefined} />
                  <MiniStat label="High interactions" value={summaryTotals.high ?? 0} accent={(summaryTotals.high ?? 0) > 0 ? "#f97316" : undefined} />
                  {hubName && <MiniStat label="Primary Hub" value={hubName} accent="#a78bfa" />}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-3 text-[10px]" style={{ color: "#7a8ba8" }}>
                  <span className="uppercase tracking-wider font-mono">Legend</span>
                  {(["low", "moderate", "high", "critical"] as const).map((s) => (
                    <span key={s} className="flex items-center gap-1 capitalize">
                      <span
                        className="w-2 h-0.5 rounded"
                        style={{ background: SEVERITY_COLORS[s], boxShadow: `0 0 6px ${SEVERITY_COLORS[s]}80` }}
                      />
                      {s}
                    </span>
                  ))}
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{ background: "#0ea5e9", boxShadow: "0 0 6px #0ea5e966" }} />
                    medication
                  </span>
                  <span className="flex items-center gap-1">
                    <span style={{ color: "#a78bfa" }}>★</span> hub
                  </span>
                  <span className="w-full sm:w-auto text-[10px]" style={{ color: "#5b6f8a" }}>
                    Select a medication or interaction to inspect details.
                  </span>
                </div>
              </div>
            )}

            {/* Risk Cascade header: honest framing that days are model units,
                not calendar dates — matching the backend's cascade semantics. */}
            {activeViz === "temporal" && effectiveTemporal && (
              <div
                className="rounded-xl p-3.5"
                style={{ background: "rgba(8,20,37,0.6)", border: "1px solid var(--border)" }}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="font-display font-semibold text-sm" style={{ color: "var(--text)" }}>
                      Risk Cascade
                    </h3>
                    <p className="text-[11px] mt-0.5" style={{ color: "#7a8ba8" }}>
                      Model projection of daily interaction risk over {effectiveTemporal.timeline_days ?? "—"} days.
                      Days are model units, not calendar dates.
                    </p>
                  </div>
                  <span
                    className="font-mono text-[10px] px-2 py-1 rounded shrink-0"
                    style={{ color: "#7a8ba8", background: "rgba(2,8,23,0.5)", border: "1px solid rgba(0,229,255,0.1)" }}
                  >
                    Drag to rotate · Hover to inspect
                  </span>
                </div>
              </div>
            )}

            {/* Viz tabs with hover animation */}
            <div className="flex gap-1 p-1 rounded-xl overflow-x-auto" style={{ background: "rgba(8,20,37,0.6)", border: "1px solid var(--border)" }}>
              {vizTabs.map((tab) => (
                <button key={tab.key} onClick={() => tab.available && setActiveViz(tab.key)}
                  className={`flex-1 min-w-[100px] py-2.5 rounded-lg text-xs font-display font-medium transition-all duration-300 ${activeViz === tab.key ? "text-[var(--primary)]" : tab.available ? "text-[#7a8ba8] hover:text-[#c8d6e8]" : "text-[#2a3a52] cursor-not-allowed"}`}
                  style={activeViz === tab.key ? {
                    background: "var(--primary-dim)",
                    border: "1px solid rgba(0,229,255,0.18)",
                  } : {
                    border: "1px solid transparent",
                    transition: "all 0.3s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (activeViz !== tab.key && tab.available) {
                      e.currentTarget.style.background = "rgba(0,229,255,0.05)";
                      e.currentTarget.style.borderColor = "rgba(0,229,255,0.1)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (activeViz !== tab.key) {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.borderColor = "transparent";
                    }
                  }}
                >
                  <span className="mr-1">{tab.icon}</span>{tab.label}
                </button>
              ))}
            </div>

            <motion.div key={activeViz} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}
              id="viz-anchor"
              className="rounded-xl overflow-hidden transition-all duration-300 relative"
              style={{ height: canvasHeight, background: "rgba(8,20,37,0.4)", border: "1px solid var(--border)" }}>
              <Scene camera={{ position: [0, 0, 8], fov: 50 }}>
                {/* R3F scene trees contain THREE elements ONLY. Missing-data
                    states are surfaced as an HTML overlay OUTSIDE <Canvas>;
                    never HTML inside the canvas. */}
                {activeViz === "graph" && effectiveGraph && (
                  <InteractionGraph3D
                    data={effectiveGraph as any}
                    onNodeHover={setGraphHover}
                    onNodeClick={(p) => {
                      if (p) {
                        setGraphNodeSel(p);
                        setGraphEdgeSel(null);
                      }
                    }}
                    onEdgeClick={(source, target) => {
                      setGraphNodeSel(null);
                      setGraphEdgeSel({ source, target });
                    }}
                    selectedEdge={graphEdgeSel}
                  />
                )}
                {activeViz === "temporal" && effectiveTemporal && (
                  <TemporalTimeline3D data={effectiveTemporal as any} onPointHover={setTimelineHover} />
                )}
                {activeViz === "radar" && (
                  <PhenotypeRadar3D
                    patient={patientCtx as any}
                    onHoverAxis={setRadarHover}
                  />
                )}
                {activeViz === "waterfall" && effectiveDeprescribing && (
                  <DeprescribingWaterfall data={effectiveDeprescribing as any} onStepClick={setDeprescribingClick} />
                )}
              </Scene>

              {/* HTML empty-state overlays, kept OUTSIDE the R3F canvas: a
                  <div> inside <Canvas> is parsed as a THREE element and
                  throws "Div is not part of the THREE namespace!". */}
              {activeViz === "graph" && !effectiveGraph && (
                <VizEmptyState message="No interaction graph was returned for this analysis." />
              )}
              {activeViz === "temporal" && !effectiveTemporal && (
                <VizEmptyState message="No risk cascade was returned for this analysis." />
              )}
              {activeViz === "waterfall" && !effectiveDeprescribing && (
                <VizEmptyState message="No deprescribing plan was returned for this analysis." />
              )}

              {/* HTML overlay side-panels, rendered OUTSIDE the 3D canvas so
                  they never get clipped. Each viz has its own panel,
                  positioned top-right. Pattern unified into VizSidePanel. */}
              {activeViz === "radar" && radarHover && (
                <VizSidePanel accentColor={radarHover.color}>
                  <SidePanelHeader
                    title={radarHover.label}
                    badge={radarHover.riskLabel}
                    accent={radarHover.color}
                  />
                  <SidePanelScore value={radarHover.score} accent={radarHover.color} />
                  <p className="text-[11px] leading-relaxed mb-2" style={{ color: "#cbd5e1" }}>
                    {radarHover.explanation}
                  </p>
                  <p
                    className="text-[10px] leading-snug flex items-start gap-1"
                    style={{ color: radarHover.value > 0.5 ? radarHover.color : "#7a8ba8" }}
                  >
                    <span className="shrink-0">
                      {radarHover.value > 0.7 ? "⚠" : radarHover.value > 0.4 ? "→" : "✓"}
                    </span>
                    <span>{radarHover.action}</span>
                  </p>
                </VizSidePanel>
              )}

              {activeViz === "graph" && activeGraphNode && (
                <VizSidePanel
                  accentColor={activeGraphNode.worst_severity ? SEVERITY_COLORS[activeGraphNode.worst_severity] : "#06b6d4"}
                  onClose={() => { setGraphNodeSel(null); setGraphEdgeSel(null); }}
                >
                  <SidePanelHeader
                    title={activeGraphNode.drug_name}
                    badge={activeGraphNode.is_hub ? "★ HUB" : undefined}
                    accent={activeGraphNode.is_hub ? "#a78bfa" : "#06b6d4"}
                  />
                  <div className="grid grid-cols-2 gap-1.5 mb-2.5">
                    <MiniStat label="Connections" value={activeGraphNode.degree} accent="#06b6d4" />
                    <MiniStat
                      label="Hub Score"
                      value={`${(activeGraphNode.hub_score * 100).toFixed(0)}%`}
                      accent={activeGraphNode.is_hub ? "#a78bfa" : undefined}
                    />
                  </div>
                  {/* Worst-severity finding for this drug, once only */}
                  {(rawInteractionList.length > 0 || (effectiveGraph?.edges ?? []).length > 0) && (
                    <p className="text-[10px] font-mono uppercase tracking-wider mb-1.5" style={{ color: "#7a8ba8" }}>
                      Highest-risk interaction
                    </p>
                  )}
                  {(() => {
                    const name = activeGraphNode.drug_name;
                    const ranked = [...(rawInteractionList ?? [])]
                      .filter((ix) => (ix.drugs ?? []).includes(name))
                      .sort((a, b) => (sevRankOf(b.severity) - sevRankOf(a.severity)));
                    const found = ranked[0];
                    if (!found) return null;
                    const fc = SEVERITY_COLORS[(found.severity ?? "").toLowerCase()] ?? "#94a8c8";
                    return (
                      <div className="mb-2">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[11px] truncate" style={{ color: "#eaf0fa" }}>
                            {(found.drugs ?? []).filter((d) => d !== name).join(" + ") || "related drug"}
                          </span>
                          <span
                            className="text-[9px] uppercase tracking-wider font-mono font-bold px-1.5 py-0.5 rounded shrink-0"
                            style={{ color: fc, background: `${fc}22`, border: `1px solid ${fc}44` }}
                          >
                            {found.severity}
                          </span>
                        </div>
                        {found.description && (
                          <p className="text-[11px] leading-relaxed mt-1" style={{ color: "#a3b8d0" }}>
                            {found.description}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                  {activeGraphNode.connected.length > 0 && (
                    <>
                      <p className="text-[10px] uppercase tracking-wider font-mono mb-1.5" style={{ color: "#7a8ba8" }}>
                        Interacts with:
                      </p>
                      <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                        {activeGraphNode.connected.map((c, i) => {
                          const sc = SEVERITY_COLORS[c.severity] ?? "#94a8c8";
                          return (
                            <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="truncate" style={{ color: "#eaf0fa" }}>{c.drug}</span>
                              <span
                                className="text-[9px] uppercase tracking-wider font-mono font-bold px-1.5 py-0.5 rounded shrink-0"
                                style={{ color: sc, background: `${sc}22`, border: `1px solid ${sc}44` }}
                              >
                                {c.severity}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </VizSidePanel>
              )}

              {/* Selected edge panel — a full finding for the clicked/linked
                  pair: type/mechanism, description, clinical significance and
                  any evidence metadata, or an explicit absence note. */}
              {activeViz === "graph" && graphEdgeSel && (() => {
                const pair: [string, string] = [graphEdgeSel.source, graphEdgeSel.target];
                const edge = (effectiveGraph?.edges ?? []).find((e) => edgeMatchesPair(e, pair));
                const ix = rawInteractionList.find((r) => drugsMatchPair(r.drugs, pair));
                const sevKey = (edge?.severity ?? ix?.severity ?? "moderate").toLowerCase();
                const accent = SEVERITY_COLORS[sevKey] ?? "#06b6d4";
                return (
                  <VizSidePanel accentColor={accent} onClose={() => setGraphEdgeSel(null)}>
                    <SidePanelHeader
                      title={`${graphEdgeSel.source} ↔ ${graphEdgeSel.target}`}
                      badge={(edge?.severity ?? ix?.severity ?? "").toUpperCase() || "INTERACTION"}
                      accent={accent}
                    />
                    <div className="mb-2">
                      <MiniStat
                        label="Type / Mechanism"
                        value={edge?.interaction_type ?? ix?.interaction_type ?? "Not specified"}
                        accent="#06b6d4"
                      />
                    </div>
                    {ix?.description && (
                      <p className="text-[11px] leading-relaxed mb-2" style={{ color: "#cbd5e1" }}>
                        {ix.description}
                      </p>
                    )}
                    {ix?.clinical_significance && (
                      <p className="text-[11px] leading-relaxed mb-2" style={{ color: "#a3b8d0" }}>
                        <span style={{ color: "#eaf0fa" }}>Clinical significance: </span>
                        {ix.clinical_significance}
                      </p>
                    )}
                    <p className="text-[10px] font-mono mb-2" style={{ color: "#5b6f8a" }}>
                      {edge
                        ? `Edge weight ${edge.weight != null ? edge.weight.toFixed(2) : "—"} · graph edge`
                        : "Finding from the interaction list (no graph edge for this exact pair)."}
                    </p>
                    <EvidenceSummary interaction={ix ?? null} mechanism={ix?.mechanism} />
                  </VizSidePanel>
                );
              })()}

              {activeViz === "temporal" && timelineHover && (
                <VizSidePanel
                  accentColor={
                    timelineHover.risk >= 8.5 ? "#ff0040" :
                    timelineHover.risk >= 5.0 ? "#f97316" :
                    timelineHover.risk >= 2.0 ? "#f59e0b" : "#06b6d4"
                  }
                >
                  <SidePanelHeader
                    title={`Day ${timelineHover.day}`}
                    badge={timelineHover.isPeak ? "PEAK" : undefined}
                    accent={timelineHover.isPeak ? "#ef4444" : "#06b6d4"}
                  />
                  <SidePanelScore
                    value={timelineHover.risk}
                    accent={
                      timelineHover.risk >= 8.5 ? "#ff0040" :
                      timelineHover.risk >= 5.0 ? "#f97316" :
                      timelineHover.risk >= 2.0 ? "#f59e0b" : "#06b6d4"
                    }
                  />
                  {timelineHover.event && (
                    <p className="text-[11px] leading-relaxed mb-2" style={{ color: "#cbd5e1" }}>
                      <span className="font-semibold" style={{ color: "#eaf0fa" }}>Event: </span>
                      {timelineHover.event}
                    </p>
                  )}
                  {timelineHover.inInterventionWindow && (
                    <p className="text-[10px] leading-snug p-1.5 rounded"
                      style={{
                        color: "#06b6d4",
                        background: "rgba(6,182,212,0.1)",
                        border: "1px solid rgba(6,182,212,0.25)",
                      }}
                    >
                      <span className="font-bold">◉ Intervention window:</span> {timelineHover.windowAction}
                    </p>
                  )}
                </VizSidePanel>
              )}

              {activeViz === "waterfall" && deprescribingClick && (
                <VizSidePanel
                  accentColor={deprescribingClick.color}
                  onClose={() => setDeprescribingClick(null)}
                >
                  <SidePanelHeader
                    title={deprescribingClick.step.drug}
                    badge={`#${deprescribingClick.step.priority}`}
                    accent={deprescribingClick.color}
                  />
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <span
                      className="text-[10px] uppercase tracking-wider font-mono font-bold px-2 py-0.5 rounded"
                      style={{
                        color: deprescribingClick.color,
                        background: `${deprescribingClick.color}22`,
                        border: `1px solid ${deprescribingClick.color}55`,
                      }}
                    >
                      {getActionLabel(deprescribingClick.step.action)}
                    </span>
                    <span className="font-mono font-bold text-base" style={{ color: "#10b981" }}>
                      -{deprescribingClick.step.expected_risk_reduction}%
                    </span>
                  </div>
                  {deprescribingClick.step.substitute && (
                    <p className="text-[11px] mb-2" style={{ color: "#e2e8f0" }}>
                      <span style={{ color: "#06b6d4", fontWeight: 600 }}>→ Substitute: </span>
                      <span className="font-semibold" style={{ color: "#7dd3fc" }}>{deprescribingClick.step.substitute}</span>
                    </p>
                  )}
                  <p className="text-[11px] leading-relaxed mb-2" style={{ color: "#e2e8f0" }}>
                    {deprescribingClick.step.rationale}
                  </p>
                  <div className="text-[10px] space-y-1">
                    <p style={{ color: "#c7d2e0" }}>
                      <span className="font-bold" style={{ color: "#f1f5f9" }}>Timeline: </span>
                      {deprescribingClick.step.timeline ?? "N/A"}
                    </p>
                    {(deprescribingClick.step.monitoring ?? []).length > 0 && (
                      <p style={{ color: "#c7d2e0" }}>
                        <span className="font-bold" style={{ color: "#f1f5f9" }}>Monitoring: </span>
                        {deprescribingClick.step.monitoring.join(", ")}
                      </p>
                    )}
                  </div>
                </VizSidePanel>
              )}
            </motion.div>

            {/* Description text — readable color */}
            <div className="text-xs text-center" style={{ color: "#8a9bba" }}>
              {activeViz === "graph" && "Force-directed 3D drug interaction graph. Scroll to zoom, drag to rotate. Hover nodes for details."}
              {activeViz === "temporal" && "Risk cascade timeline. Scroll to zoom, drag to rotate. Hover points for details."}
              {activeViz === "radar" && "Patient phenotype risk across six axes. Scroll to zoom, drag to rotate. Hover for interpretation."}
              {activeViz === "waterfall" && "Deprescribing steps by priority. Scroll to zoom, drag to rotate. Click bars for details."}
            </div>

            <AnimatePresence mode="wait">
              <motion.div key={activeViz} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                {activeViz === "graph" && <GraphInterpretation graph={effectiveGraph} />}
                {activeViz === "temporal" && <TimelineInterpretation temporal={effectiveTemporal} />}
                {activeViz === "radar" && <PhenotypeInterpretation request={request} />}
                {activeViz === "waterfall" && <DeprescribingInterpretation plan={effectiveDeprescribing} />}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Right */}
          <div className="lg:col-span-2 space-y-4">
            {/* Risk Assessment — hover glow */}
            <HoverCard borderColor={riskInfo.color} delay={0.1}>
              <h3 className="font-display font-semibold text-xs uppercase tracking-wider mb-3" style={{ color: riskInfo.color }}>Overall Risk Assessment</h3>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-5xl font-display font-bold" style={{ color: riskInfo.color }}>{numScore.toFixed(1)}</span>
                <span style={{ color: "#7a8ba8" }} className="text-lg">/ 10</span>
              </div>
              <div className="text-xs font-display font-bold tracking-widest mb-3" style={{ color: riskInfo.color }}>{riskInfo.label}</div>
              <div className="h-2 rounded-full overflow-hidden mb-3" style={{ background: "#0f172a" }}>
                <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${numScore * 10}%` }}
                  transition={{ duration: 1, ease: "easeOut", delay: 0.3 }} style={{ background: "linear-gradient(90deg,#10b981,#f59e0b,#f97316,#ff0040)" }} />
              </div>
              <div className="flex justify-between text-[10px] mb-3" style={{ color: "#6b7c96" }}>{[0,2,4,6,8,10].map(n=><span key={n}>{n}</span>)}</div>
              <div className="rounded-lg p-3 text-xs leading-relaxed mb-2" style={{ background: riskInfo.bgColor, border: `1px solid ${riskInfo.color}22`, color: "#d0daea" }}>
                <span className="font-semibold" style={{ color: riskInfo.color }}>Interpretation:</span> {riskInfo.description}
              </div>
              {/* Per-score clinical context.
                  Bands are the canonical four severity tiers from
                  `lib/severity.ts` — anything else (5-band, 3-band, etc.)
                  would visually contradict the big colored label above
                  and the InteractionCard pills below. The active row is
                  picked by literal band containment, so an 8.6 lights up
                  the CRITICAL row (8.5–10.0), never the HIGH row. */}
              <div className="rounded-lg p-3 text-[11px] leading-relaxed space-y-1" style={{ background: "rgba(8,20,37,0.5)", border: "1px solid rgba(0,229,255,0.07)" }}>
                <p style={{ color: "#7a8ba8" }} className="font-semibold mb-1.5">Score Scale Reference:</p>
                {[
                  { range: "0.0–2.0", min: 0.0, max: 2.0, label: "Low",      color: "#10b981", desc: "Minimal risk. Routine monitoring sufficient. No immediate high-priority review identified." },
                  { range: "2.0–5.0", min: 2.0, max: 5.0, label: "Moderate", color: "#f59e0b", desc: "Enhanced monitoring recommended. Consider dose adjustments or alternative therapies if risk factors change." },
                  { range: "5.0–8.5", min: 5.0, max: 8.5, label: "High",     color: "#f97316", desc: "Significant clinical concern. Clinical review of therapy, including potential deprescribing or substitution, is recommended." },
                  { range: "8.5–10",  min: 8.5, max: 10.0, label: "Critical", color: "#ff0040", desc: "Urgent clinical review recommended. High probability of severe adverse events without prompt change." },
                ].map((s, i) => {
                  // Band containment: `[min, max)` for the lower three,
                  // `[8.5, 10]` for the top band. Matches `severity.ts`.
                  const isActive =
                    s.max === 10.0
                      ? numScore >= s.min && numScore <= s.max
                      : numScore >= s.min && numScore < s.max;
                  return (
                    <div
                      key={i}
                      className="flex gap-2 items-start rounded px-1.5 py-1"
                      style={{
                        opacity: isActive ? 1 : 0.5,
                        background: isActive ? `${s.color}14` : "transparent",
                        boxShadow: isActive ? `inset 3px 0 0 ${s.color}` : "none",
                        fontWeight: isActive ? 600 : 400,
                        transition:
                          "background-color 0.3s ease, box-shadow 0.3s ease, color 0.3s ease, opacity 0.3s ease",
                        cursor: "default",
                      }}
                      onMouseEnter={(e) => {
                        const el = e.currentTarget;
                        el.style.background = `${s.color}1f`;
                        el.style.boxShadow = `inset 3px 0 0 ${s.color}`;
                        el.style.opacity = "1";
                        el.style.fontWeight = "600";
                        const spans = el.querySelectorAll("span");
                        if (spans[1]) (spans[1] as HTMLElement).style.color = "#eaf0fa";
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget;
                        el.style.background = isActive ? `${s.color}14` : "transparent";
                        el.style.boxShadow = isActive ? `inset 3px 0 0 ${s.color}` : "none";
                        el.style.opacity = isActive ? "1" : "0.5";
                        el.style.fontWeight = isActive ? "600" : "400";
                        const spans = el.querySelectorAll("span");
                        if (spans[1]) (spans[1] as HTMLElement).style.color = isActive ? "#d0daea" : "#94a8c8";
                      }}
                    >
                      <span
                        className="font-mono font-bold shrink-0 w-12"
                        style={{ color: s.color }}
                      >
                        {s.range}
                      </span>
                      <span
                        style={{
                          color: isActive ? "#d0daea" : "#94a8c8",
                          transition: "color 0.3s ease",
                        }}
                      >
                        {s.desc}
                      </span>
                    </div>
                  );
                })}
              </div>
            </HoverCard>


            <RiskReport data={data} />
          </div>
        </div>

        {errors.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-8 p-4 rounded-xl"
            style={{ background: "rgba(255,171,0,0.04)", border: "1px solid rgba(255,171,0,0.15)" }}>
            <h3 className="font-display font-semibold text-xs uppercase tracking-wider mb-2" style={{ color: "var(--warning)" }}>Pipeline Warnings</h3>
            {errors.map((err, i) => <p key={i} style={{ color: "#8a9bba" }} className="text-xs mb-1">{err}</p>)}
          </motion.div>
        )}
      </div>
    </div></>
  );
}

// ── Build patient summary from all analysis data ──────────
export interface PatientSummaryData {
  /** Short one-line intro, e.g. "72-year-old female with CKD stage 3". */
  headline: string;
  /** Structured bullets with highlighted values. Parent renders each as a
   *  row with the `value` bold and colored. */
  bullets: Array<{
    label: string;
    value: string;
    color?: string;
  }>;
}

function buildPatientSummary(
  patient: any,
  data: AnalyzeResponse,
  graph: InteractionGraph | null,
  temporal: CascadeModel | null,
  deprescribing: DeprescribingPlan | null,
  request?: AnalyzeRequest | null,
): PatientSummaryData {
  // Headline: "72-year-old female with CKD stage 3, hepatic impairment"
  const age = patient.age ?? 0;
  const sex = patient.sex ?? "unknown";
  const head: string[] = [];
  if (age > 0 || sex !== "unknown") {
    head.push(`${age > 0 ? age + "-year-old" : ""} ${sex !== "unknown" ? sex : "patient"}`.trim());
  }
  const risks: string[] = [];
  if ((patient.ckd_stage ?? 0) >= 3) risks.push(`CKD stage ${patient.ckd_stage}`);
  if (patient.hepatic_impairment) risks.push("hepatic impairment");
  if (patient.smoking) risks.push("active smoker");
  if (risks.length > 0) head.push(`with ${risks.join(", ")}`);
  const headline = head.length > 0 ? head.join(" ") + "." : "Patient summary not available.";

  // Bullets — key stats with bold values
  const bullets: PatientSummaryData["bullets"] = [];
  const medCount = resolveMedicationCount(data, graph, request);
  if (typeof medCount === "number") {
    bullets.push({ label: "Medications on record", value: String(medCount) });
  }

  const totals = resolveInteractionTotals(data);
  if (totals.total !== undefined) {
    bullets.push({ label: "Interactions identified", value: String(totals.total), color: "#06b6d4" });
  }
  if (totals.critical) {
    bullets.push({ label: "Critical interactions", value: String(totals.critical), color: "#ff0040" });
  }
  if (totals.high) {
    bullets.push({ label: "High interactions", value: String(totals.high), color: "#f97316" });
  }

  if (temporal && (temporal.peak_risk_score ?? 0) > 0) {
    const peakColor =
      temporal.peak_risk_score >= 8.5 ? "#ff0040" :
      temporal.peak_risk_score >= 5.0 ? "#f97316" :
      temporal.peak_risk_score >= 2.0 ? "#f59e0b" : "#06b6d4";
    bullets.push({
      label: "Peak modeled risk",
      value: `${temporal.peak_risk_score.toFixed(1)}/10 · model day ${temporal.peak_risk_day}`,
      color: peakColor,
    });
  }

  if (deprescribing && (deprescribing.steps ?? []).length > 0) {
    bullets.push({
      label: "Deprescribing plan",
      value: `${deprescribing.steps.length} steps · -${deprescribing.total_expected_risk_reduction ?? 0}% risk reduction`,
      color: "#10b981",
    });
  }

  return { headline, bullets };
}

/** Legacy string form of the summary for places that need plain text
 *  (PDF export, sessionStorage snapshots, etc). */
function patientSummaryAsText(s: PatientSummaryData): string {
  const parts = [s.headline];
  for (const b of s.bullets) parts.push(`${b.label}: ${b.value}.`);
  return parts.join(" ");
}
