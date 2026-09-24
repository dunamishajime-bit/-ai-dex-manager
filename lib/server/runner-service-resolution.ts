export type AlertRunnerId =
  | "V12"
  | "PENGU_V8"
  | "V52"
  | "FET_BRK48_RESIDUAL"
  | "QUALITY102_CAUSAL_V1"
  | "SHARED_CRYPTO_RISK"
  | "MARGIN_GUARD";

const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/i;

const SERVICE_PREFIX: Record<AlertRunnerId, string> = {
  V12: "disdex-v12-x1-all@",
  PENGU_V8: "disdex-pengu-dual-ls-v2@",
  V52: "disdex-v52-aster-only@",
  FET_BRK48_RESIDUAL: "disdex-fet-brk48@",
  QUALITY102_CAUSAL_V1: "disdex-quality102-causal-v1@",
  SHARED_CRYPTO_RISK: "disdex-shared-crypto-risk@",
  MARGIN_GUARD: "disdex-v12-v52-margin-guard@",
};

export function normalizeCurrentReleaseSha(value: string | undefined) {
  const sha = value?.trim().toLowerCase() || "";
  return RELEASE_SHA_PATTERN.test(sha) ? sha : undefined;
}

export function expectedRunnerServiceUnit(runnerId: AlertRunnerId, releaseSha: string) {
  const normalizedSha = normalizeCurrentReleaseSha(releaseSha);
  if (!normalizedSha) return undefined;
  return `${SERVICE_PREFIX[runnerId]}${normalizedSha}.service`;
}

export function resolveRunnerServiceUnit(runnerId: AlertRunnerId, releaseSha: string | undefined) {
  const normalizedSha = normalizeCurrentReleaseSha(releaseSha);
  if (!normalizedSha) {
    return {
      unit: "",
      releaseSha: undefined,
      failClosed: true,
      detail: "current release SHAを確認できないためFail Closed",
    } as const;
  }
  return {
    unit: `${SERVICE_PREFIX[runnerId]}${normalizedSha}.service`,
    releaseSha: normalizedSha,
    failClosed: false,
    detail: `current release ${normalizedSha} のunitを使用`,
  } as const;
}
