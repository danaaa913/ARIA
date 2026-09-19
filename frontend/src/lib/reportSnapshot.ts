/**
 * RxNexus report snapshot — single source of truth for the report page.
 *
 * The report MUST render one completed analysis and nothing else. To make
 * that enforceable, the analyze page persists request + result together as a
 * single versioned snapshot, and every selector on this module resolves a
 * metric from REAL backend data only.
 *
 * Policy:
 *  - Demo/fixture data (Quick Test profiles) is used ONLY to prefill the
 *    Analyze form. It never feeds report metrics.
 *  - A section that is genuinely absent (empty graph, missing temporal
 *    model, zero deprescribing steps) resolves to `null` / an empty totals
 *    object. Callers show an honest unavailable state or omit the value —
 *    never a substitute and never a fabricated zero.
 *  - Legacy pre-fix keys (`rxnexus-result` / `rxnexus-request`) are ignored
 *    and removed. No migration: an old snapshot is treated as expired.
 */

import type {
  AnalyzeRequest,
  AnalyzeResponse,
  CascadeModel,
  DeprescribingPlan,
  InteractionGraph,
  InteractionReport,
} from "./types";

export const RX_SNAPSHOT_KEY = "rxnexus-snapshot";
export const RX_SNAPSHOT_SCHEMA_VERSION = 1;
export const LEGACY_REPORT_KEYS = ["rxnexus-result", "rxnexus-request"] as const;

export interface ReportSnapshot {
  request: AnalyzeRequest | null;
  result: AnalyzeResponse | null;
  createdAt: string | null;
  schemaVersion: number;
}

type SnapshotStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// ── Real-only selectors ──────────────────────────────────
// A response like `{ nodes: [], edges: [] }` is an EMPTY backend section,
// never a demo replacement trigger.

function hasRealGraph(
  g: AnalyzeResponse["interaction_graph"],
): g is InteractionGraph {
  return (
    !!g &&
    Array.isArray(g.nodes) &&
    g.nodes.length > 0 &&
    Array.isArray(g.edges) &&
    g.edges.length > 0
  );
}

function hasRealTemporal(
  t: AnalyzeResponse["temporal_model"],
): t is CascadeModel {
  return !!t && Array.isArray(t.daily_risk) && t.daily_risk.length > 0;
}

function hasRealPlan(
  d: AnalyzeResponse["deprescribing_plan"],
): d is DeprescribingPlan {
  return !!d && Array.isArray(d.steps) && d.steps.length > 0;
}

export function resolveGraph(data: AnalyzeResponse | null): InteractionGraph | null {
  if (!data) return null;
  return hasRealGraph(data.interaction_graph) ? data.interaction_graph : null;
}

export function resolveTemporal(data: AnalyzeResponse | null): CascadeModel | null {
  if (!data) return null;
  return hasRealTemporal(data.temporal_model) ? data.temporal_model : null;
}

export function resolveDeprescribing(
  data: AnalyzeResponse | null,
): DeprescribingPlan | null {
  if (!data) return null;
  return hasRealPlan(data.deprescribing_plan) ? data.deprescribing_plan : null;
}

export interface InteractionTotals {
  /** undefined only when the response has no interaction data at all. */
  total?: number;
  critical?: number;
  high?: number;
}

function severityCount(list: Array<{ severity?: string }>, sev: string): number {
  return list.filter((i) => (i.severity ?? "").toLowerCase() === sev).length;
}

export function rawInteractionList(
  data: AnalyzeResponse | null,
): InteractionReport["interactions"] {
  return data?.raw_interactions?.interactions ?? [];
}

/**
 * Resolve interaction totals from the real response only.
 * Priority: raw_interactions (richest, authoritative) → interaction graph
 * edges. Returns `{}` when the response truly carries no interaction data so
 * callers can render "—" instead of faking a zero.
 */
export function resolveInteractionTotals(
  data: AnalyzeResponse | null,
): InteractionTotals {
  if (!data) return {};
  const raw = data.raw_interactions;
  const rawList = raw?.interactions ?? [];
  if (rawList.length > 0) {
    return {
      total: raw?.total_interactions ?? rawList.length,
      critical: severityCount(rawList, "critical"),
      high: severityCount(rawList, "high"),
    };
  }
  const edges = resolveGraph(data)?.edges ?? [];
  if (edges.length > 0) {
    return {
      total: edges.length,
      critical: severityCount(edges, "critical"),
      high: severityCount(edges, "high"),
    };
  }
  return {};
}

// ── Snapshot persistence ─────────────────────────────────
// One key, one analysis. `readSnapshot` self-invalidates: any unexpected
// payload or a stale schemaVersion clears the snapshot and the pre-fix
// legacy keys; a missing snapshot still cleans up the legacy keys.

function removeLegacyKeys(storage: SnapshotStorage): void {
  for (const key of LEGACY_REPORT_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // ignore storage errors
    }
  }
}

export function writeSnapshot(
  storage: SnapshotStorage,
  request: AnalyzeRequest,
  result: AnalyzeResponse,
): void {
  const snapshot: ReportSnapshot = {
    request,
    result,
    createdAt: new Date().toISOString(),
    schemaVersion: RX_SNAPSHOT_SCHEMA_VERSION,
  };
  storage.setItem(RX_SNAPSHOT_KEY, JSON.stringify(snapshot));
  removeLegacyKeys(storage);
}

export function clearSnapshot(storage: SnapshotStorage): void {
  try {
    storage.removeItem(RX_SNAPSHOT_KEY);
  } catch {
    // ignore storage errors
  }
  removeLegacyKeys(storage);
}

/**
 * Read the active snapshot. Returns `null` (and removes the stale snapshot
 * plus legacy keys) when there is no valid versioned snapshot.
 */
export function readSnapshot(storage: SnapshotStorage): ReportSnapshot | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(RX_SNAPSHOT_KEY);
  } catch {
    clearSnapshot(storage);
    return null;
  }
  if (!raw) {
    // No snapshot: make sure legacy analysis keys can't be picked up later.
    removeLegacyKeys(storage);
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ReportSnapshot>;
    if (
      parsed &&
      parsed.schemaVersion === RX_SNAPSHOT_SCHEMA_VERSION &&
      parsed.result &&
      typeof parsed.result === "object" &&
      parsed.request &&
      typeof parsed.request === "object"
    ) {
      return {
        request: parsed.request as AnalyzeRequest,
        result: parsed.result as AnalyzeResponse,
        createdAt:
          typeof parsed.createdAt === "string" ? parsed.createdAt : null,
        schemaVersion: RX_SNAPSHOT_SCHEMA_VERSION,
      };
    }
  } catch {
    // malformed payload falls through and is treated as expired
  }
  clearSnapshot(storage);
  return null;
}