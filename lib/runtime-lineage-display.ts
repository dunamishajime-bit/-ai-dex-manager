type RuntimeLineageUnit = {
  runtimeSha?: string;
  expectedSha?: string;
  matchesCurrent: boolean;
};

type RuntimeLineage = {
  synchronized: boolean;
  units: Record<string, RuntimeLineageUnit>;
};

type RuntimeWithLineage = {
  releaseSha: string;
  runtimeLineage: RuntimeLineage;
};

export type RuntimeLineageDisplay = {
  tone: "healthy" | "scoped" | "warning";
  label: string;
  detail: string;
};

const INDEPENDENT_SCOPES = new Map<string, string>([
  ["quality102", "Q102"],
  ["v52", "V52"],
]);

function declaredShaAligned(unit: RuntimeLineageUnit) {
  return Boolean(
    unit.runtimeSha
      && unit.expectedSha
      && /^[0-9a-f]{40}$/i.test(unit.runtimeSha)
      && /^[0-9a-f]{40}$/i.test(unit.expectedSha)
      && unit.runtimeSha.toLowerCase() === unit.expectedSha.toLowerCase(),
  );
}

/**
 * The shared `current` release is the peer lineage for independently promoted
 * runners. A different SHA is therefore not automatically a fault: the
 * runner's own runtime and expected SHA must agree, while an actual
 * runtime-vs-expected mismatch remains a warning.
 */
export function buildRuntimeLineageDisplay(runtime: RuntimeWithLineage): RuntimeLineageDisplay {
  const shortSha = runtime.releaseSha.slice(0, 12);
  if (runtime.runtimeLineage.synchronized) {
    return {
      tone: "healthy",
      label: `Production ${shortSha} / runtime SHA同期`,
      detail: "すべての共有系Runnerがcurrent Production SHAと同期しています。",
    };
  }

  const independent = [...INDEPENDENT_SCOPES.entries()]
    .filter(([key]) => {
      const unit = runtime.runtimeLineage.units[key];
      return Boolean(unit && !unit.matchesCurrent && declaredShaAligned(unit));
    })
    .map(([, label]) => label);
  const mismatched = Object.entries(runtime.runtimeLineage.units)
    .filter(([key, unit]) => {
      if (unit.matchesCurrent) return false;
      return !(INDEPENDENT_SCOPES.has(key) && declaredShaAligned(unit));
    })
    .map(([key]) => INDEPENDENT_SCOPES.get(key) ?? key);

  if (mismatched.length === 0 && independent.length > 0) {
    return {
      tone: "scoped",
      label: `Production ${shortSha} / scope別 SHA同期`,
      detail: `独立Runnerの自己SHA整合を確認済み: ${independent.join(" / ")}。共有peer SHAは ${shortSha}。`,
    };
  }

  return {
    tone: "warning",
    label: `Production ${shortSha} / RUNTIME MISMATCH`,
    detail: `SHA系譜の未整合: ${mismatched.join(" / ") || "runtime lineage"}。発注可否は各RunnerのFail-Closed判定に従います。`,
  };
}
