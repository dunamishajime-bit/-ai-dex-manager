import {
  classifyRunnerAlertTransition,
  type RunnerAlertTransition,
  type RunnerHealthStatus,
} from "./runtime-alert-policy";

/** A health alert is sent only after two consecutive observations. */
export const REQUIRED_CONSECUTIVE_OBSERVATIONS = 2;

/** A failed delivery is retried at most once every fifteen minutes. */
export const DELIVERY_RETRY_INTERVAL_MS = 15 * 60 * 1000;

export type V4EvidenceExpiryStatus = "FRESH" | "EXPIRING_SOON" | "EXPIRED" | "BLOCKED";
export type V4EvidenceExpirySnapshot = {
  status: V4EvidenceExpiryStatus;
  earliestExpiryAt?: string;
  remainingMs?: number | null;
  expiringKeys: string[];
  sha: string;
};
export type V4EvidenceExpiryRecord = {
  lastObservedStatus?: V4EvidenceExpiryStatus;
  lastNotifiedStatus?: V4EvidenceExpiryStatus;
  candidateStatus?: V4EvidenceExpiryStatus;
  candidateCount?: number;
  lastAttemptAt?: string;
  lastNotifiedAt?: string;
  lastObservedSha?: string;
  lastObservedKeys?: string[];
};
export type V4EvidenceExpiryObservation = {
  record: V4EvidenceExpiryRecord;
  previousNotifiedStatus?: V4EvidenceExpiryStatus;
  transition: "UNHEALTHY" | "RECOVERED" | "NONE";
  shouldSend: boolean;
};

export type RunnerAlertRecord = {
  lastObservedStatus?: RunnerHealthStatus;
  lastNotifiedStatus?: RunnerHealthStatus;
  candidateStatus?: RunnerHealthStatus;
  candidateCount?: number;
  lastAttemptAt?: string;
  lastNotifiedAt?: string;
};

export type RunnerAlertObservation = {
  record: RunnerAlertRecord;
  previousNotifiedStatus?: RunnerHealthStatus;
  transition: RunnerAlertTransition;
  shouldSend: boolean;
};

function timestamp(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Fold one read-only systemd observation into the persistent alert state.
 *
 * The monitor deliberately uses the last delivered state for transition
 * detection. This means a mail transport outage cannot create a new mail on
 * every one-minute timer tick; it can only retry the same incident after the
 * bounded retry interval.
 */
export function observeRunnerStatus(
  previous: RunnerAlertRecord | undefined,
  current: RunnerHealthStatus,
  now = new Date(),
): RunnerAlertObservation {
  const prior = previous || {};
  const candidateCount = prior.candidateStatus === current
    ? Math.min((prior.candidateCount || 0) + 1, REQUIRED_CONSECUTIVE_OBSERVATIONS)
    : 1;
  const base: RunnerAlertRecord = {
    ...prior,
    lastObservedStatus: current,
    candidateStatus: current,
    candidateCount,
  };
  const previousNotifiedStatus = prior.lastNotifiedStatus;

  // V52's market-hours stop is intentionally quiet and becomes the new
  // baseline, so market open does not generate a false recovery message.
  if (current === "INTENTIONAL_STOP") {
    return {
      record: {
        ...base,
        lastNotifiedStatus: "INTENTIONAL_STOP",
        lastAttemptAt: undefined,
      },
      previousNotifiedStatus,
      transition: "NONE",
      shouldSend: false,
    };
  }

  if (candidateCount < REQUIRED_CONSECUTIVE_OBSERVATIONS) {
    return { record: base, previousNotifiedStatus, transition: "NONE", shouldSend: false };
  }

  const transition = classifyRunnerAlertTransition(previousNotifiedStatus, current);
  if (transition === "NONE") {
    return { record: base, previousNotifiedStatus, transition, shouldSend: false };
  }

  const lastAttempt = timestamp(prior.lastAttemptAt);
  const retryReady = lastAttempt === undefined || now.getTime() - lastAttempt >= DELIVERY_RETRY_INTERVAL_MS;
  return {
    record: base,
    previousNotifiedStatus,
    transition,
    shouldSend: retryReady,
  };
}

export function markRunnerAlertAttempt(record: RunnerAlertRecord, now = new Date()): RunnerAlertRecord {
  return { ...record, lastAttemptAt: now.toISOString() };
}

export function markRunnerAlertDelivered(
  record: RunnerAlertRecord,
  status: RunnerHealthStatus,
  now = new Date(),
): RunnerAlertRecord {
  return {
    ...record,
    lastNotifiedStatus: status,
    lastAttemptAt: undefined,
    lastNotifiedAt: now.toISOString(),
  };
}

function expiryTimestamp(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Fold one V4 evidence observation into the same bounded alert state machine
 * used by the runner monitor.  Expiry is an alert only; it never renews a
 * proof or changes the V4 order permission.
 */
export function observeV4EvidenceExpiry(
  previous: V4EvidenceExpiryRecord | undefined,
  current: V4EvidenceExpirySnapshot,
  now = new Date(),
): V4EvidenceExpiryObservation {
  const prior = previous || {};
  const candidateCount = prior.candidateStatus === current.status
    ? Math.min((prior.candidateCount || 0) + 1, REQUIRED_CONSECUTIVE_OBSERVATIONS)
    : 1;
  const base: V4EvidenceExpiryRecord = {
    ...prior,
    lastObservedStatus: current.status,
    candidateStatus: current.status,
    candidateCount,
    lastObservedSha: current.sha,
    lastObservedKeys: [...current.expiringKeys],
  };
  const previousNotifiedStatus = prior.lastNotifiedStatus;
  if (candidateCount < REQUIRED_CONSECUTIVE_OBSERVATIONS) {
    return { record: base, previousNotifiedStatus, transition: "NONE", shouldSend: false };
  }
  const recovered = current.status === "FRESH"
    && previousNotifiedStatus !== undefined
    && previousNotifiedStatus !== "FRESH";
  const unhealthy = current.status !== "FRESH" && previousNotifiedStatus !== current.status;
  if (!recovered && !unhealthy) return { record: base, previousNotifiedStatus, transition: "NONE", shouldSend: false };
  const lastAttempt = expiryTimestamp(prior.lastAttemptAt);
  const retryReady = lastAttempt === undefined || now.getTime() - lastAttempt >= DELIVERY_RETRY_INTERVAL_MS;
  return {
    record: base,
    previousNotifiedStatus,
    transition: recovered ? "RECOVERED" : "UNHEALTHY",
    shouldSend: retryReady,
  };
}

export function markV4EvidenceExpiryAttempt(record: V4EvidenceExpiryRecord, now = new Date()): V4EvidenceExpiryRecord {
  return { ...record, lastAttemptAt: now.toISOString() };
}

export function markV4EvidenceExpiryDelivered(record: V4EvidenceExpiryRecord, now = new Date()): V4EvidenceExpiryRecord {
  return {
    ...record,
    lastNotifiedStatus: record.candidateStatus || record.lastObservedStatus || "BLOCKED",
    lastAttemptAt: undefined,
    lastNotifiedAt: now.toISOString(),
  };
}

/** Build the V4 proof-expiry mail without performing delivery or renewal. */
export function formatV4EvidenceExpiryEmail(input: V4EvidenceExpirySnapshot) {
  const isRecovery = input.status === "FRESH";
  const observedAt = new Date();
  const observedAtJst = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(observedAt);
  const statusLabel = input.status === "FRESH"
    ? "新鮮"
    : input.status === "EXPIRING_SOON"
      ? "期限接近"
      : input.status === "EXPIRED"
        ? "期限切れ"
        : "読み取り不能／BLOCKED";
  const subject = isRecovery
    ? "[DisTERMINAL] V4証跡の復旧通知"
    : "[DisTERMINAL] V4証跡の期限警告";
  const text = [
    "DisTERMINALのV4証跡期限監視通知です。",
    "",
    `候補SHA: ${input.sha}`,
    `証跡状態: ${statusLabel}`,
    `期限: ${input.earliestExpiryAt || "取得不能"}`,
    `残り時間(ms): ${input.remainingMs === null || input.remainingMs === undefined ? "UNKNOWN" : input.remainingMs}`,
    `対象キー: ${input.expiringKeys.length ? input.expiringKeys.join(", ") : "なし"}`,
    `確認日時（日本時間）: ${observedAtJst}`,
    "",
    isRecovery
      ? "動的な口座・リスク証拠の読み取り監視が新鮮な状態へ戻りました。"
      : "新規注文はBLOCKEDのままです。静的release証明を変更せず、正規の署名付き取得元から動的証拠を再検証してください。",
    "この通知は読み取り専用で、証跡の更新、注文、取消、建玉、STOP、Kill Switch、LIVE承認を実行しません。",
  ].join("\n");
  return { subject, text };
}

function statusLabel(status: RunnerHealthStatus) {
  switch (status) {
    case "ACTIVE": return "稼働中";
    case "INACTIVE": return "停止中";
    case "FAILED": return "失敗状態";
    case "UNKNOWN": return "状態不明";
    case "INTENTIONAL_STOP": return "市場時間外の意図停止";
  }
}

/** Build the user-facing Japanese inspection mail without performing delivery. */
export function formatRunnerHealthEmail(input: {
  runnerLabel: string;
  service: string;
  status: RunnerHealthStatus;
  previousStatus?: RunnerHealthStatus;
  transition: Exclude<RunnerAlertTransition, "NONE">;
  observedAt?: Date;
  detail?: string;
}) {
  const recovered = input.transition === "RECOVERED";
  const subject = recovered
    ? `[DisTERMINAL] 復旧通知：${input.runnerLabel}`
    : `[DisTERMINAL] 点検異常：${input.runnerLabel}`;
  const observedAt = input.observedAt || new Date();
  const observedAtJst = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(observedAt);
  const text = [
    "DisTERMINALの読み取り専用ランナー点検通知です。",
    "",
    `対象ロジック: ${input.runnerLabel}`,
    `systemdサービス: ${input.service}`,
    `現在の状態: ${statusLabel(input.status)}`,
    `前回通知済み状態: ${input.previousStatus ? statusLabel(input.previousStatus) : "初回確認"}`,
    `検知内容: ${recovered ? "異常状態から復旧しました。" : "停止または異常状態を連続確認しました。"}`,
    `確認日時（日本時間）: ${observedAtJst}`,
    ...(input.detail ? [`詳細: ${input.detail}`] : []),
    "",
    "この監視は読み取り専用です。注文、取消、建玉、Kill Switch、LIVE承認ゲートは変更していません。",
    "同一障害の重複通知は抑制し、メール送信失敗時も一定間隔でのみ再試行します。",
  ].join("\n");
  return { subject, text };
}
