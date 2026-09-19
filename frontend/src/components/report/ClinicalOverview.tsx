"use client";

import type { ReactNode, CSSProperties } from "react";
import type { BurdenScores } from "@/lib/types";

/**
 * "Clinical Overview" band for the Report dashboard.
 *
 * Shows only metrics the backend genuinely returns in the AnalyzeResponse:
 * overall regimen risk (score + band), medication/interaction counts,
 * the highest-connected drug (when the interaction graph exposes hub_drugs),
 * renal dosing concerns (when a renal assessment exists), and cumulative
 * burden scores (when burden scores were computed). Cards that have no real
 * data source are simply not rendered — the dashboard never invents a metric.
 */

interface RiskInfoShape {
  label: string;
  level: "low" | "moderate" | "high" | "critical";
  color: string;
  bgColor: string;
  description: string;
}

interface ClinicalOverviewProps {
  score: number;
  riskInfo: RiskInfoShape;
  /** Resolved medication count; `undefined` when no backend source exists —
   *  the card must then omit the count rather than show a fabricated 0. */
  medications?: number;
  interactions?: { count: number; critical: number; high: number };
  hub?: { drug: string; degree: number; hubScore: number; isHub: boolean };
  renal?: { flagged: number; egfrRange?: string; ckdStage?: number };
  burden?: BurdenScores;
}

const LEVEL_COLORS: Record<string, string> = {
  low: "#10b981",
  moderate: "#f59e0b",
  high: "#f97316",
  critical: "#ff0040",
};

function cardClass(): string {
  return "rounded-xl p-4 sm:p-5 flex flex-col gap-2 min-h-0 transition-colors duration-200";
}

function cardStyle(): CSSProperties {
  return {
    background: "rgba(8, 20, 37, 0.55)",
    border: "1px solid var(--border)",
  };
}

function CardLabel({ children }: { children: ReactNode }) {
  return (
    <p
      className="text-[10px] uppercase tracking-widest"
      style={{ fontFamily: "var(--font-mono)", color: "#7a8ba8" }}
    >
      {children}
    </p>
  );
}

function LevelChip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded shrink-0"
      style={{ color, background: `${color}1c`, border: `1px solid ${color}3d` }}
    >
      {label}
    </span>
  );
}

export function ClinicalOverview({
  score,
  riskInfo,
  medications,
  interactions,
  hub,
  renal,
  burden,
}: ClinicalOverviewProps) {
  const numScore = Number.isFinite(score) ? score : 0;
  const ix = interactions;

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2
          className="font-display font-semibold text-xl"
          style={{ color: "var(--text)" }}
        >
          Clinical Overview
        </h2>
        <span
          className="text-[10px] uppercase tracking-widest"
          style={{ fontFamily: "var(--font-mono)", color: "#7a8ba8" }}
        >
          Decision support only
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Overall regimen risk */}
        <div className={cardClass()} style={cardStyle()}>
          <CardLabel>Overall Regimen Risk</CardLabel>
          <div className="flex items-baseline gap-2">
            <span
              className="font-display font-bold text-3xl leading-none"
              style={{ color: riskInfo.color }}
            >
              {numScore.toFixed(1)}
              <span className="text-base opacity-60">/10</span>
            </span>
            <LevelChip label={riskInfo.label.replace(" RISK", "")} color={riskInfo.color} />
          </div>
          <p className="text-xs leading-relaxed" style={{ color: "#a3b8d0" }}>
            {riskInfo.description}
          </p>
        </div>

        {/* Regimen size + interaction load */}
        <div className={cardClass()} style={cardStyle()}>
          <CardLabel>Regimen Review</CardLabel>
          {medications !== undefined ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-display font-bold text-3xl leading-none" style={{ color: "var(--text)" }}>
                  {medications}
                </span>
                <span className="text-xs" style={{ color: "#7a8ba8" }}>
                  medications analyzed
                </span>
              </div>
              <div className="text-xs leading-relaxed" style={{ color: "#a3b8d0" }}>
                {ix ? (
                  <>
                    {ix.count} interaction{ix.count === 1 ? "" : "s"} detected
                    {ix.critical + ix.high > 0 && (
                      <span className="mt-1 block">
                        {ix.critical > 0 && (
                          <LevelChip label={`${ix.critical} critical`} color="#ff0040" />
                        )}
                        {ix.high > 0 && (
                          <>
                            {" "}
                            <LevelChip label={`${ix.high} high`} color="#f97316" />
                          </>
                        )}
                      </span>
                    )}
                  </>
                ) : (
                  "No interaction data returned — the interaction analysis component did not produce output."
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-display font-bold text-3xl leading-none" style={{ color: "var(--text)" }}>
                  {ix ? ix.count : "—"}
                </span>
                {ix && (
                  <span className="text-xs" style={{ color: "#7a8ba8" }}>
                    interaction{ix.count === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <div className="text-xs leading-relaxed" style={{ color: "#a3b8d0" }}>
                {ix && ix.critical + ix.high > 0 ? (
                  <span className="mt-1 block">
                    {ix.critical > 0 && <LevelChip label={`${ix.critical} critical`} color="#ff0040" />}
                    {ix.high > 0 && (
                      <>
                        {" "}
                        <LevelChip label={`${ix.high} high`} color="#f97316" />
                      </>
                    )}
                  </span>
                ) : ix ? (
                  "returned interaction analysis result"
                ) : (
                  "No interaction data returned."
                )}
              </div>
            </>
          )}
        </div>

        {/* Primary risk hub (only when the graph exposes hub_drugs) */}
        {hub && (
          <div className={cardClass()} style={cardStyle()}>
            <CardLabel>Primary Risk Hub</CardLabel>
            <div className="flex items-baseline gap-2 min-w-0">
              <span
                className="font-display font-bold text-xl leading-none truncate"
                style={{ color: "var(--primary)", textTransform: "capitalize" }}
              >
                {hub.drug}
              </span>
              {hub.isHub && <LevelChip label="hub" color="#a78bfa" />}
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "#a3b8d0" }}>
              {hub.degree} connection{hub.degree === 1 ? "" : "s"} · hub score{" "}
              {(hub.hubScore * 100).toFixed(0)}%
            </p>
          </div>
        )}

        {/* Renal dosing concerns (only when an assessment exists) */}
        {renal && (
          <div className={cardClass()} style={cardStyle()}>
            <CardLabel>Renal Dosing</CardLabel>
            <div className="flex items-baseline gap-2">
              <span
                className="font-display font-bold text-3xl leading-none"
                style={{ color: renal.flagged > 0 ? "#f97316" : "var(--text)" }}
              >
                {renal.flagged}
              </span>
              <span className="text-xs" style={{ color: "#7a8ba8" }}>
                drug{renal.flagged === 1 ? "" : "s"} flagged for review
              </span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "#a3b8d0" }}>
              {renal.egfrRange && (
                <>
                  est. eGFR {renal.egfrRange} mL/min/1.73m²
                  {renal.ckdStage ? ` · CKD stage ${renal.ckdStage}` : ""}
                </>
              )}
              {!renal.egfrRange && renal.ckdStage
                ? `CKD stage ${renal.ckdStage}`
                : ""}
            </p>
          </div>
        )}

        {/* Cumulative burden (only when burden scores were computed) */}
        {burden && (
          <div className={cardClass()} style={cardStyle()}>
            <CardLabel>Cumulative Burden</CardLabel>
            <div className="space-y-1.5">
              {[
                { label: "Anticholinergic", d: burden.anticholinergic_burden },
                { label: "Sedative", d: burden.sedation_load },
                { label: "QT-prolonging", d: burden.qt_prolongation_risk },
              ].map(({ label, d }) => {
                const total = typeof d?.total_score === "number" ? d.total_score : 0;
                const lvl = (d?.risk_level ?? "low").toLowerCase();
                const color = LEVEL_COLORS[lvl] ?? "#10b981";
                return (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span style={{ color: "#a3b8d0" }}>{label}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono" style={{ color: "var(--text)" }}>
                        {total.toFixed(1)}
                      </span>
                      <LevelChip label={lvl} color={color} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}