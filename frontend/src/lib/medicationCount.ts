import type { AnalyzeRequest, AnalyzeResponse, InteractionGraph } from "@/lib/types";

/**
 * Resolve the regimen's medication count for display.
 *
 * Sources, in priority order:
 *  1. `report.medication_count` — authoritative, when the agent emits it
 *  2. `interaction_graph.nodes.length` — the analyzed drug set from the graph
 *  3. the analyzed request's medication list — only when reliably available
 *     in page state (the report always holds the request it was built from)
 *
 * Returns `undefined` when NO source exists so callers can omit the count
 * entirely instead of rendering a fabricated 0.
 */
export function resolveMedicationCount(
  data: AnalyzeResponse,
  graph: InteractionGraph | null | undefined,
  request: AnalyzeRequest | null | undefined,
): number | undefined {
  const fromReport = data.report?.medication_count;
  if (typeof fromReport === "number" && Number.isFinite(fromReport) && fromReport > 0) {
    return Math.round(fromReport);
  }
  if (graph && Array.isArray(graph.nodes) && graph.nodes.length > 0) {
    return graph.nodes.length;
  }
  if (Array.isArray(request?.medications) && request!.medications.length > 0) {
    const names = request!.medications
      .map((m) => (typeof m === "string" ? m : m?.name))
      .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
    if (names.length > 0) return names.length;
  }
  return undefined;
}