/**
 * Point-in-time model-versus-runner pin audit, NOT live health state.
 * These three source cases were built from pre-Codex V4 research economics.
 * Every related UI notice remains advisory; source hashes prove neither
 * current service liveness nor signed venue fills/STOP protection.
 */
export const V4_PIN_OBSERVED_2026_11_15 =
  "e788abc82e80f9fc7ab0e1ba83fdb8be267eb513";

export const V4_MISMATCHED_RESEARCH_CASES = [
  "STABLE4_OPPORTUNITY_PROD_CAPS_20261114_GROSS_CAPTURE_V1",
  "STABLE4_OPPORTUNITY_PROD_CAPS_20261114_NATIVE_HYPE_TREND_SOURCE_GROSS_20261115_V1",
  "STABLE4_OPPORTUNITY_PROD_CAPS_20261114_NO_HYPE_SIDECAR_SOURCE_GROSS_20261115_V1",
] as const;

export function observedV4MismatchInResearchSource(sourceCase:string|undefined):boolean {
  return typeof sourceCase==="string" &&
    (V4_MISMATCHED_RESEARCH_CASES as readonly string[]).includes(sourceCase);
}
