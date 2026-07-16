export interface PerpLogicRegistry {
  version: 1;
  fingerprints: string[];
  totalUniqueEvaluated: number;
  totalDuplicateSkipped: number;
  updatedAt: string | null;
}

export function createEmptyPerpLogicRegistry(): PerpLogicRegistry {
  return {
    version: 1,
    fingerprints: [],
    totalUniqueEvaluated: 0,
    totalDuplicateSkipped: 0,
    updatedAt: null,
  };
}

export function normalizePerpLogicRegistry(value: unknown): PerpLogicRegistry {
  const fallback = createEmptyPerpLogicRegistry();
  if (!value || typeof value !== "object") return fallback;
  const input = value as Partial<PerpLogicRegistry>;
  const fingerprints = Array.isArray(input.fingerprints)
    ? [...new Set(input.fingerprints.filter((item): item is string => typeof item === "string" && item.length > 0))]
    : [];

  return {
    version: 1,
    fingerprints,
    totalUniqueEvaluated: Math.max(
      fingerprints.length,
      Number.isFinite(input.totalUniqueEvaluated) ? Number(input.totalUniqueEvaluated) : 0,
    ),
    totalDuplicateSkipped: Number.isFinite(input.totalDuplicateSkipped)
      ? Math.max(0, Number(input.totalDuplicateSkipped))
      : 0,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : null,
  };
}

export function mergePerpLogicRegistry(input: {
  previous: PerpLogicRegistry;
  evaluatedFingerprints: Iterable<string>;
  duplicateStrategiesSkipped: number;
  updatedAt: string;
}) {
  const known = new Set(input.previous.fingerprints);
  let added = 0;
  for (const fingerprint of input.evaluatedFingerprints) {
    if (!known.has(fingerprint)) {
      known.add(fingerprint);
      added += 1;
    }
  }

  return {
    registry: {
      version: 1 as const,
      fingerprints: [...known],
      totalUniqueEvaluated: input.previous.totalUniqueEvaluated + added,
      totalDuplicateSkipped:
        input.previous.totalDuplicateSkipped + Math.max(0, input.duplicateStrategiesSkipped),
      updatedAt: input.updatedAt,
    },
    added,
  };
}
