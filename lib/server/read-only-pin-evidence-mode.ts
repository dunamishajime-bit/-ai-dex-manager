/**
 * The installed v1 root pin manifest uses dash-separated evidenceMode values,
 * while older HP readers expected underscores. Both are only allowed for
 * display-identity resolution; v1 never becomes an order authorization source.
 */
export function acceptsV1ReadOnlyEvidenceMode(mode: unknown): boolean {
  return typeof mode === "string" &&
    ["legacy", "heartbeat_v1", "tick_v1", "heartbeat-v1", "tick-v1"].includes(mode);
}
