import {
  classifyRunnerAlertTransition,
  type RunnerAlertTransition,
  type RunnerHealthStatus,
} from "./runtime-alert-policy";

/** A health alert is sent only after two consecutive observations. */
export const REQUIRED_CONSECUTIVE_OBSERVATIONS = 2;

/** A failed delivery is retried at most once every fifteen minutes. */
export const DELIVERY_RETRY_INTERVAL_MS = 15 * 60 * 1000;

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
 * A mail transport outage cannot create a new mail on every timer tick; it
 * can only retry the same incident after the bounded retry interval.
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
