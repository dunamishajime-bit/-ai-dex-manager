import { V12_V4_HP_TARGET, type V12V4HpDisplayStatus, type V12V4HpSnapshot } from "@/lib/v12-v4-hp-contract";

export type V12V4HpPresentation = {
  target: typeof V12_V4_HP_TARGET;
  runtimeStatus: V12V4HpDisplayStatus;
  runtimeLabel: string;
  isLiveVerified: boolean;
  actualSummary: string;
};

export type V12V4HpPresentationOptions = { loading?: boolean; error?: string | null };

export type V12V4LiveStatus = "LIVE" | "STALE" | "UNAVAILABLE";

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

export function v12V4LiveStatus(snapshot: V12V4HpSnapshot | null): V12V4LiveStatus {
  if (snapshot?.displayStatus === "LIVE_VERIFIED") return "LIVE";
  if (snapshot?.displayStatus === "STALE") return "STALE";
  return "UNAVAILABLE";
}

function exactLiveEvidence(snapshot: V12V4HpSnapshot): boolean {
  const actual = snapshot.actual;
  // The V4 runner has an independent release lineage. currentReleaseSha is the
  // shared Production parent used by the other runners, while the three V4
  // fields must agree with one another and identify the active V4 unit.
  const currentSha = actual.currentReleaseSha?.toLowerCase();
  const v4Sha = actual.activeRunnerSha?.toLowerCase();
  const v4ShaValues = [actual.activeRunnerSha, actual.v4ReleaseSha, actual.heartbeatSha];
  return snapshot.displayStatus === "LIVE_VERIFIED" &&
    typeof currentSha === "string" && SHA_RE.test(currentSha) &&
    typeof v4Sha === "string" && SHA_RE.test(v4Sha) &&
    v4ShaValues.every((sha) => typeof sha === "string" && SHA_RE.test(sha) && sha.toLowerCase() === v4Sha) &&
    actual.activeRunnerState === "active/running" &&
    actual.activeRunnerId?.includes(v4Sha) === true &&
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
