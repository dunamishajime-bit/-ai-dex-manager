export type AlertRunnerId =
  | "V12"
  | "PENGU_V8"
  | "V52"
  | "FET_BRK48_RESIDUAL"
  | "HYPE_TREND_LONG"
  | "IDLE_PRIORITY_SHORT"
  | "QUALITY102_CAUSAL_V1"
  | "SHARED_CRYPTO_RISK"
  | "MARGIN_GUARD";

const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/i;

const SERVICE_PREFIX: Record<AlertRunnerId, string> = {
  V12: "disdex-v12-x1-all@",
  PENGU_V8: "disdex-pengu-dual-ls-v2@",
  V52: "disdex-v52-aster-only@",
  FET_BRK48_RESIDUAL: "disdex-fet-brk48@",
  HYPE_TREND_LONG: "disdex-hype-long@",
  IDLE_PRIORITY_SHORT: "disdex-idle-priority-short@",
  QUALITY102_CAUSAL_V1: "disdex-quality102-causal-v1@",
  SHARED_CRYPTO_RISK: "disdex-shared-crypto-risk@",
  MARGIN_GUARD: "disdex-v12-v52-margin-guard@",
};

export function expectedShaOverrideEnv(runnerId: AlertRunnerId) {
  switch (runnerId) {
    case "V12":
      return "DISDEX_ALERT_V12_EXPECTED_SHA";
    case "HYPE_TREND_LONG":
      return "DISDEX_ALERT_HYPE_EXPECTED_SHA";
    case "IDLE_PRIORITY_SHORT":
      return "DISDEX_ALERT_IDLE_EXPECTED_SHA";
    default:
      return undefined;
  }
}

export function normalizeCurrentReleaseSha(value: string | undefined) {
  const sha = value?.trim().toLowerCase() || "";
  return RELEASE_SHA_PATTERN.test(sha) ? sha : undefined;
}

export function expectedRunnerServiceUnit(runnerId: AlertRunnerId, releaseSha: string) {
  const normalizedSha = normalizeCurrentReleaseSha(releaseSha);
  if (!normalizedSha) return undefined;
  return `${SERVICE_PREFIX[runnerId]}${normalizedSha}.service`;
}

export function resolveRunnerServiceUnit(
  runnerId: AlertRunnerId,
  releaseSha: string | undefined,
  explicitUnit?: string,
  expectedShaOverride?: string,
) {
  const normalizedCurrentSha = normalizeCurrentReleaseSha(releaseSha);
  if (!normalizedCurrentSha) {
    return {
      unit: "",
      releaseSha: undefined,
      failClosed: true,
      detail: "current release SHAを確認できないためFail Closed",
    } as const;
  }
  const overrideSupplied = expectedShaOverride !== undefined;
  const normalizedSha = overrideSupplied
    ? normalizeCurrentReleaseSha(expectedShaOverride)
    : normalizedCurrentSha;
  if (!normalizedSha) {
    return {
      unit: explicitUnit?.trim() || "",
      releaseSha: undefined,
      failClosed: true,
      detail: `runner expected SHAが不正なためFail Closed (current=${normalizedCurrentSha})`,
    } as const;
  }
  if (overrideSupplied && !explicitUnit?.trim()) {
    return {
      unit: "",
      releaseSha: normalizedSha,
      failClosed: true,
      detail: `runner expected SHA ${normalizedSha} に対する明示unitが未設定のためFail Closed`,
    } as const;
  }
  const expected = `${SERVICE_PREFIX[runnerId]}${normalizedSha}.service`;
  if (explicitUnit?.trim()) {
    const unit = explicitUnit.trim();
    const allowed = runnerId === "V12"
      ? new Set([expected, `disdex-v12-v4@${normalizedSha}.service`])
      : new Set([expected]);
    if (!allowed.has(unit)) {
      return {
        unit,
        releaseSha: normalizedSha,
        failClosed: true,
        detail: `明示unitがrunner expected SHA ${normalizedSha} と一致しないためFail Closed`,
      } as const;
    }
    return {
      unit,
      releaseSha: normalizedSha,
      failClosed: false,
      detail: overrideSupplied
        ? `runner expected release ${normalizedSha} の明示unitを使用 (current=${normalizedCurrentSha})`
        : `current release ${normalizedSha} の明示unitを使用`,
    } as const;
  }
  return {
    unit: expected,
    releaseSha: normalizedSha,
    failClosed: false,
    detail: `current release ${normalizedSha} のunitを使用`,
  } as const;
}
