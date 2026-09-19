"use client";

/**
 * Evidence experience for a single finding.
 *
 * Renders ONLY metadata the backend actually returns:
 * - evidence grade (A/B/C/D) with its standard descriptive label
 * - confidence score (0–100)
 * - PubMed identifiers as preserved external links
 * - an existing mechanism explanation when supplied
 *
 * When the backend returns no evidence metadata, the component says so
 * verbatim instead of inventing placeholders or implying "high confidence".
 */

import { EvidenceBadge } from "./EvidenceBadge";
import type { EvidenceGrade } from "@/lib/types";

export interface EvidenceSummaryProps {
  interaction?: {
    evidence_grade?: EvidenceGrade | string | null;
    confidence_score?: number | null;
    pubmed_ids?: string[];
  } | null;
  mechanism?: string | null;
  className?: string;
}

export function EvidenceSummary({
  interaction,
  mechanism,
  className,
}: EvidenceSummaryProps) {
  const grade = interaction?.evidence_grade ?? null;
  const confidence = interaction?.confidence_score ?? null;
  const pubmed = Array.isArray(interaction?.pubmed_ids)
    ? interaction!.pubmed_ids
    : [];

  const hasGrade = typeof grade === "string" && grade.length > 0;
  const hasConfidence =
    typeof confidence === "number" && Number.isFinite(confidence);
  const hasPubmed = pubmed.length > 0;
  const hasEvidenceMetadata = hasGrade || hasConfidence || hasPubmed;

  const link =
    "text-[10px] px-2.5 py-1 rounded inline-flex items-center gap-1 transition-all duration-200";
  const linkStyle = {
    color: "var(--primary, #06b6d4)",
    background: "rgba(0, 229, 255, 0.06)",
    border: "1px solid rgba(0, 229, 255, 0.15)",
  };

  return (
    <div className={className}>
      {(hasGrade || hasConfidence) && (
        <div className="flex items-center flex-wrap gap-2 mb-2">
          {hasGrade && (
            <EvidenceBadge
              grade={(grade as EvidenceGrade) || "D"}
              confidence={hasConfidence ? confidence ?? undefined : undefined}
              compact
            />
          )}
          {!hasGrade && hasConfidence && (
            <span
              className="font-mono text-[11px] px-2 py-0.5 rounded"
              style={{
                color: "#06b6d4",
                background: "rgba(6, 182, 212, 0.1)",
                border: "1px solid rgba(6, 182, 212, 0.25)",
              }}
            >
              Confidence {confidence!.toFixed(0)}%
            </span>
          )}
        </div>
      )}

      {hasPubmed && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {pubmed.map((pmid) => (
            <a
              key={pmid}
              href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
              target="_blank"
              rel="noopener noreferrer"
              className={link}
              style={linkStyle}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.45)";
                e.currentTarget.style.boxShadow =
                  "0 0 14px rgba(0, 229, 255, 0.2)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(0, 229, 255, 0.15)";
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              📎 PMID:{pmid}
            </a>
          ))}
        </div>
      )}

      {mechanism && (
        <p
          className="text-[11px] leading-relaxed"
          style={{ color: "#c7d2e0" }}
        >
          <span className="font-semibold" style={{ color: "#eaf0fa" }}>
            Mechanism:{" "}
          </span>
          {mechanism}
        </p>
      )}

      {!hasEvidenceMetadata && !mechanism && (
        <p
          className="text-[11px] leading-relaxed"
          style={{ color: "#7a8ba8", fontStyle: "italic" }}
        >
          No structured evidence metadata returned for this finding.
        </p>
      )}
    </div>
  );
}