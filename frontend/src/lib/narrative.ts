/**
 * Detect when a report "narrative" field actually holds an upstream
 * model/API error string (e.g. a rate-limit rejection) instead of clinical
 * prose.
 *
 * These strings must NEVER be rendered as if they were clinical narrative.
 * When detected, surfaces should show a neutral "narrative unavailable"
 * state while keeping the structured/deterministic analysis visible.
 * Technical details remain in agent logs / developer context only.
 */
export function isUpstreamModelError(text: string | null | undefined): boolean {
  if (!text || typeof text !== "string") return false;
  const head = text.slice(0, 500).toLowerCase();
  if (!head.includes("error") && !head.includes("too many requests")) return false;

  const patterns: RegExp[] = [
    /(^|[^a-z])(gemini|openai|anthropic|claude|google\s*(ai\s*)?api|upstream|api error)([^a-z]|$)/i,
    /\b(429|5\d\d)\b/,
    /too many requests/i,
  ];
  return patterns.some((p) => p.test(head));
}