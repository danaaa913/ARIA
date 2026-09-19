"use client";

/**
 * "Clinical Review Priorities" band for the Report dashboard.
 *
 * Renders the top review-worthy findings combining high/critical drug
 * interaction pairs and deprescribing steps, mapped from data the backend
 * actually returns. Every action chip uses the safety-tier copy from
 * `getActionLabel()` — never direct prescriptive instructions.
 */

export interface ReviewPriorityItem {
  id: string;
  title: string;
  badge: string;
  badgeColor: string;
  description: string;
  actionLabel: string;
  evidence?: string;
  timeline?: string;
}

interface ClinicalReviewPrioritiesProps {
  items: ReviewPriorityItem[];
  emptyLabel?: string;
}

function PriorityCard({ item, index }: { item: ReviewPriorityItem; index: number }) {
  return (
    <div
      className="rounded-xl p-4 flex gap-3 transition-colors duration-200 hover:bg-black/20"
      style={{ background: "rgba(8, 20, 37, 0.55)", border: "1px solid var(--border)" }}
    >
      <div
        className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-mono font-bold mt-0.5"
        style={{
          background: "var(--primary-dim)",
          color: "var(--primary)",
          border: "1px solid rgba(0, 229, 255, 0.18)",
        }}
      >
        {index + 1}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <h3
            className="font-display font-semibold text-sm leading-snug min-w-0"
            style={{ color: "var(--text)" }}
          >
            {item.title}
          </h3>
          <span
            className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded shrink-0"
            style={{
              color: item.badgeColor,
              background: `${item.badgeColor}1c`,
              border: `1px solid ${item.badgeColor}3d`,
            }}
          >
            {item.badge}
          </span>
        </div>

        <p
          className="text-xs leading-relaxed mt-1.5"
          style={{ color: "#a3b8d0" }}
        >
          {item.description}
        </p>

        <div className="flex items-center gap-2 flex-wrap mt-2.5">
          <span
            className="text-[10px] uppercase tracking-wider font-medium px-2.5 py-1 rounded"
            style={{
              background: "rgba(0, 229, 255, 0.08)",
              color: "var(--primary)",
              border: "1px solid rgba(0, 229, 255, 0.18)",
            }}
          >
            {item.actionLabel}
          </span>
          {item.evidence && (
            <span className="text-[10px] font-mono" style={{ color: "#7a8ba8" }}>
              {item.evidence}
            </span>
          )}
          {item.timeline && (
            <span className="text-[10px] font-mono" style={{ color: "#7a8ba8" }}>
              {item.timeline}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function ClinicalReviewPriorities({ items, emptyLabel }: ClinicalReviewPrioritiesProps) {
  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2
            className="font-display font-semibold text-xl"
            style={{ color: "var(--text)" }}
          >
            Clinical Review Priorities
          </h2>
          {items.length > 0 && (
            <span
              className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded"
              style={{
                background: "rgba(249, 115, 22, 0.1)",
                color: "#f97316",
                border: "1px solid rgba(249, 115, 22, 0.25)",
              }}
            >
              {items.length} flagged
            </span>
          )}
        </div>
        <span
          className="text-[10px] uppercase tracking-widest"
          style={{ fontFamily: "var(--font-mono)", color: "#7a8ba8" }}
        >
          Highest risk first
        </span>
      </div>

      {items.length === 0 ? (
        <div
          className="rounded-xl px-4 py-8 text-center text-xs"
          style={{
            background: "rgba(8, 20, 37, 0.4)",
            border: "1px solid var(--border)",
            color: "#7a8ba8",
          }}
        >
          {emptyLabel ?? "No additional high-priority review items were returned for this analysis."}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, i) => (
            <PriorityCard key={item.id} item={item} index={i} />
          ))}
        </div>
      )}
    </section>
  );
}