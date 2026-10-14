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
    case "SHADOW": return "SHADOW / LIVE未確認";
    case "STALE": return "STALE / LIVE未確認";
    case "SHA_MISMATCH": return "SHA不一致 / LIVE未確認";
    case "SOURCE_ERROR": return "取得エラー / LIVE未確認";
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
  // V4 has its own exact production SHA. The peer release stays on its
  // separate shared SHA; forcing V4 == peer produces a false "SHA mismatch".
  // Exact runner/service/heartbeat equality is still required; the API must
  // independently have established LIVE_VERIFIED (no display-side override).
  const currentSha = actual.currentReleaseSha?.toLowerCase();
  const runnerSha = actual.activeRunnerSha?.toLowerCase();
  const runnerReleaseSha = actual.v4ReleaseSha?.toLowerCase();
  const heartbeatSha = actual.heartbeatSha?.toLowerCase();
  return snapshot.displayStatus === "LIVE_VERIFIED" &&
    !!currentSha && SHA_RE.test(currentSha) &&
    !!runnerSha && SHA_RE.test(runnerSha) &&
    runnerReleaseSha === runnerSha && heartbeatSha === runnerSha &&
    actual.activeRunnerState === "active/running" &&
    actual.activeRunnerId === `disdex-v12-v4@${runnerSha}.service` &&
    actual.v4RunnerMode === "CERTIFIED" &&
    actual.v12PrimaryMode === "V4" &&
    actual.legacyV12RunnerActive === false &&
    snapshot.freshness.heartbeat &&
    snapshot.readOnly === true && snapshot.tradingMutation === 0;
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
