import { V12_V4_HP_TARGET, type V12V4HpDisplayStatus, type V12V4HpSnapshot } from "@/lib/v12-v4-hp-contract";

export type V12V4HpPresentation = {
  target: typeof V12_V4_HP_TARGET;
  runtimeStatus: V12V4HpDisplayStatus;
  runtimeLabel: string;
  isLiveVerified: boolean;
  actualSummary: string;
};

export type V12V4HpPresentationOptions = { loading?: boolean; error?: string | null };

const SHA_RE = /^[a-f0-9]{40}$/i;

function statusLabel(status: V12V4HpDisplayStatus): string {
  switch (status) {
    case "LIVE_VERIFIED": return "LIVE確認済み";
    case "STAGED_NOT_LIVE": return "V4仕様 / 本番未切替";
    case "SHADOW": return "SHADOW / 発注不可";
    case "STALE": return "STALE / 発注不可";
    case "SHA_MISMATCH": return "SHA不一致 / 発注不可";
    case "SOURCE_ERROR": return "取得エラー / 発注不可";
    case "UNAVAILABLE": return "runtime未取得 / LIVE未確認";
  }
}

function actualSummary(snapshot: V12V4HpSnapshot | null): string {
  if (!snapshot) return "実runtime未取得";
  const actual = snapshot.actual;
  const runner = actual.activeRunnerId ?? "runner未確認";
  const sha = actual.activeRunnerSha?.slice(0, 12) ?? "SHA未確認";
  return `${actual.v4RunnerMode} / primary ${actual.v12PrimaryMode} / ${runner} / ${sha}`;
}

function exactLiveEvidence(snapshot: V12V4HpSnapshot): boolean {
  const actual = snapshot.actual;
  const shaValues = [actual.currentReleaseSha, actual.activeRunnerSha, actual.v4ReleaseSha, actual.heartbeatSha];
  const currentSha = actual.currentReleaseSha?.toLowerCase();
  return snapshot.displayStatus === "LIVE_VERIFIED" &&
    shaValues.every((sha) => typeof sha === "string" && SHA_RE.test(sha) && sha.toLowerCase() === currentSha) &&
    actual.activeRunnerState === "active/running" &&
    actual.activeRunnerId?.includes(currentSha ?? "") === true &&
    actual.v4RunnerMode === "CERTIFIED" &&
    actual.v12PrimaryMode === "V4" &&
    actual.legacyV12RunnerActive === false &&
    actual.orderEnabled === true &&
    snapshot.freshness.heartbeat && snapshot.freshness.decision &&
    snapshot.errors.length === 0 && snapshot.readOnly === true && snapshot.tradingMutation === 0;
}

export function buildV12V4HpPresentation(
  snapshot: V12V4HpSnapshot | null,
  options: V12V4HpPresentationOptions = {},
): V12V4HpPresentation {
  let runtimeStatus: V12V4HpDisplayStatus;
  if (!snapshot) runtimeStatus = options.loading ? "UNAVAILABLE" : options.error ? "SOURCE_ERROR" : "UNAVAILABLE";
  else if (snapshot.displayStatus === "LIVE_VERIFIED" && !exactLiveEvidence(snapshot)) runtimeStatus = "SHA_MISMATCH";
  else runtimeStatus = snapshot.displayStatus;

  return {
    target: V12_V4_HP_TARGET,
    runtimeStatus,
    runtimeLabel: statusLabel(runtimeStatus),
    isLiveVerified: runtimeStatus === "LIVE_VERIFIED" && snapshot !== null && exactLiveEvidence(snapshot),
    actualSummary: actualSummary(snapshot),
  };
}
