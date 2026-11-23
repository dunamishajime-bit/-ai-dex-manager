export function buildPenguQuality102IntegrationEvent(input: {
  expectedRuntimeSha?: string;
}) {
  return {
    event: "quality102-causal-v1-integration" as const,
    ownershipCheck: "PER_TICK" as const,
    expectedRuntimeSha: input.expectedRuntimeSha || null,
    legacySelectorManifestRequired: false as const,
  };
}
