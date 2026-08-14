import { execFileSync } from "node:child_process";
import fs from "node:fs";

import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

type Sleeve = "V96" | "V52";
type Status = "発火候補" | "条件不足" | "対象時間外" | "取得不能" | "判定未出力" | "停止中";
type Side = "LONG" | "SHORT" | "WAIT";
type JsonRecord = Record<string, unknown>;

export type DecisionStatusItem = {
  symbol: string;
  sleeve: Sleeve;
  rank: number;
  score: number;
  scoreMax: number;
  status: Status;
  side: Side;
  reason: string;
  checkedAt: string;
  source: string;
  dataUpdatedAt?: string;
};

export type DecisionStatusSnapshot = {
  ok: boolean;
  readOnly: true;
  refreshIntervalMinutes: 1;
  checkedAt: string;
  source: string;
  service: {
    active: boolean;
    state: "ACTIVE" | "STOPPED" | "UNKNOWN";
    label: string;
    mainPid: number | null;
  };
  v96: { items: DecisionStatusItem[] };
  v52: {
    marketOpen: boolean;
    marketLabel: string;
    items: DecisionStatusItem[];
    runtime: V52RuntimeStatus;
  };
  error?: string;
};

type V52RuntimeStatus = {
  status: "ACTIVE" | "BLOCKED_DATA_UNAVAILABLE" | "STALE" | "UNAVAILABLE" | "STOPPED";
  ordersAllowed: boolean;
  updatedAt?: string;
  failureCode?: string;
  source: string;
};

const DEFAULT_RUNTIME_ROOT =
  "/home/deploy/ai-dex-manager-v96-paper/.runtime-state/disdex-v13d-v11eq-v96";
const CRYPTO_DECISION_PATH =
  process.env.DISDEX_V96_DECISION_STATUS_PATH?.trim()
  || `${DEFAULT_RUNTIME_ROOT}/crypto-v96/decision-status.json`;
const PENGU_V2_STATE_PATH =
  process.env.PENGU_DUAL_LS_V2_DECISION_SNAPSHOT_PATH?.trim()
  || `${DEFAULT_RUNTIME_ROOT}/crypto-v96/pengu-dual-ls-v2-final/runner-live.json`;
const STOCK_DECISION_PATH =
  process.env.DISDEX_V52_DECISION_STATUS_PATH?.trim()
  || `${DEFAULT_RUNTIME_ROOT}/stock/decision-status.json`;
const STOCK_RUNNER_STATE_PATH =
  process.env.DISDEX_V52_RUNNER_STATE_PATH?.trim()
  || `${DEFAULT_RUNTIME_ROOT}/stock/runner-live.json`;
const SNAPSHOT_MAX_AGE_MS = 90 * 60 * 1000;
const RUNNER_HEARTBEAT_MAX_AGE_MS = 5 * 60 * 1000;
const CACHE_TTL_MS = 30 * 1000;

let cache: { expiresAt: number; snapshot: DecisionStatusSnapshot } | null = null;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function readJson(path: string): JsonRecord | null {
  try {
    return asRecord(JSON.parse(fs.readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

export function parseRuntimeTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function iso(value: unknown): string | undefined {
  const parsed = parseRuntimeTimestamp(value);
  return parsed === null ? undefined : new Date(parsed).toISOString();
}

function isFresh(value: unknown, now: number): boolean {
  return isFreshWithin(value, now, SNAPSHOT_MAX_AGE_MS);
}

function isFreshWithin(value: unknown, now: number, maxAgeMs: number): boolean {
  const parsed = parseRuntimeTimestamp(value);
  return parsed !== null && parsed <= now + 60_000 && now - parsed <= maxAgeMs;
}

function runtimeTimestamp(record: JsonRecord | null): unknown {
  if (!record) return null;
  return record.updatedAt ?? record.checkedAt ?? record.lastRunAt ?? record.dataUpdatedAt ?? null;
}

function referenceFailureCode(record: JsonRecord | null): string | undefined {
  const failure = asRecord(record?.referenceFailure);
  const code = failure?.code ?? record?.lastTransientDataCategory;
  return typeof code === "string" && code.trim() ? code.trim() : undefined;
}

function readV52Runtime(serviceActive: boolean, now: number): V52RuntimeStatus {
  if (!serviceActive) {
    return { status: "STOPPED", ordersAllowed: false, source: "systemd / VPS runtime" };
  }

  const runner = readJson(STOCK_RUNNER_STATE_PATH);
  const updatedAt = runtimeTimestamp(runner);
  const updatedAtIso = iso(updatedAt);
  const failureCode = referenceFailureCode(runner);
  if (!runner || !isFreshWithin(updatedAt, now, RUNNER_HEARTBEAT_MAX_AGE_MS)) {
    return {
      status: "STALE",
      ordersAllowed: false,
      updatedAt: updatedAtIso,
      source: "V52 runner-live.json heartbeat",
    };
  }

  const referenceStatus = String(runner.referenceStatus ?? "").toUpperCase();
  const ordersAllowed = runner.referenceOrdersAllowed === true;
  if (referenceStatus === "BLOCKED_DATA_UNAVAILABLE" || !ordersAllowed) {
    return {
      status: "BLOCKED_DATA_UNAVAILABLE",
      ordersAllowed: false,
      updatedAt: updatedAtIso,
      failureCode,
      source: "V52 runner-live.json",
    };
  }
  if (referenceStatus === "ACTIVE" && ordersAllowed) {
    return {
      status: "ACTIVE",
      ordersAllowed: true,
      updatedAt: updatedAtIso,
      source: "V52 runner-live.json",
    };
  }
  return {
    status: "UNAVAILABLE",
    ordersAllowed: false,
    updatedAt: updatedAtIso,
    failureCode,
    source: "V52 runner-live.json",
  };
}

function v52RuntimeReason(runtime: V52RuntimeStatus): string {
  if (runtime.status === "BLOCKED_DATA_UNAVAILABLE") {
    return `V52実Runnerの参照データGateが未通過です${runtime.failureCode ? `（${runtime.failureCode}）` : ""}。このtickの注文は停止しています。データ復旧後に再検証します。`;
  }
  if (runtime.status === "STALE") {
    return "V52実Runnerのheartbeatが古いため、最新状態を確認できません。発火候補を推測表示せず、注文を停止しています。";
  }
  if (runtime.status === "STOPPED") {
    return "LIVEサービスが停止中のため、現在の発火候補はありません。過去データから推測表示しません。";
  }
  return "V52実Runnerの最新状態を取得できないため、発火候補を推測表示していません。";
}

function loadTradingService() {
  try {
    const output = execFileSync(
      "/usr/bin/systemctl",
      [
        "show",
        "disdex-v96-v52-live.service",
        "--property=ActiveState,SubState,MainPID",
        "--no-pager",
      ],
      { encoding: "utf8", timeout: 2_000, stdio: ["ignore", "pipe", "ignore"] },
    );
    const fields = Object.fromEntries(
      output.trim().split(/\r?\n/).map((line) => {
        const index = line.indexOf("=");
        return index >= 0 ? [line.slice(0, index), line.slice(index + 1)] : [line, ""];
      }),
    );
    const mainPid = Number(fields.MainPID);
    const active = fields.ActiveState === "active" && fields.SubState === "running" && mainPid > 0;
    return {
      active,
      state: active ? "ACTIVE" as const : "STOPPED" as const,
      label: active ? "LIVEサービス稼働中" : "LIVEサービス停止中",
      mainPid: Number.isFinite(mainPid) ? mainPid : null,
    };
  } catch {
    return {
      active: false,
      state: "UNKNOWN" as const,
      label: "LIVEサービス状態を確認できません",
      mainPid: null,
    };
  }
}

function newYorkMarketClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  const minutes = (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
  const weekday = values.weekday;
  const open = weekday !== "Sat" && weekday !== "Sun" && minutes >= 570 && minutes < 960;
  return { open, label: "米国株式市場 09:30–16:00（ニューヨーク時間）" };
}

function stoppedItem(symbol: string, sleeve: Sleeve, checkedAt: string): DecisionStatusItem {
  return {
    symbol,
    sleeve,
    rank: 0,
    score: 0,
    scoreMax: 1,
    status: "停止中",
    side: "WAIT",
    reason: "LIVEサービスが停止中のため、現在の発火候補はありません。過去データから推測表示しません。",
    checkedAt,
    source: "systemd / VPS runtime",
  };
}

function unavailableItem(
  symbol: string,
  sleeve: Sleeve,
  checkedAt: string,
  reason: string,
  dataUpdatedAt?: string,
): DecisionStatusItem {
  return {
    symbol,
    sleeve,
    rank: 0,
    score: 0,
    scoreMax: 1,
    status: "取得不能",
    side: "WAIT",
    reason,
    checkedAt,
    source: "VPS runtime snapshot",
    dataUpdatedAt,
  };
}

function decisionNotPublishedItem(
  symbol: string,
  checkedAt: string,
  dataUpdatedAt?: string,
): DecisionStatusItem {
  return {
    symbol,
    sleeve: "V52",
    rank: 0,
    score: 0,
    scoreMax: 1,
    status: "判定未出力",
    side: "WAIT",
    reason: "V52実Runner・参照データGate・注文許可は正常です。銘柄別の読み取り専用判定スナップショットだけが未出力のため、発火候補や条件不足を推測表示していません。",
    checkedAt,
    source: "V52 runner heartbeat",
    dataUpdatedAt,
  };
}

function outsideMarketItem(symbol: string, checkedAt: string, marketLabel: string): DecisionStatusItem {
  return {
    symbol,
    sleeve: "V52",
    rank: 0,
    score: 0,
    scoreMax: 1,
    status: "対象時間外",
    side: "WAIT",
    reason: "米国株式市場の対象時間外です。V52は市場開始まで新規判定・注文を行いません。",
    checkedAt,
    source: marketLabel,
  };
}

function normalizeSide(value: unknown): Side {
  if (value === 1 || String(value).toUpperCase() === "LONG") return "LONG";
  if (value === -1 || String(value).toUpperCase() === "SHORT") return "SHORT";
  return "WAIT";
}

export function translateV52Reason(reason: unknown): string {
  const code = String(reason ?? "UNKNOWN");
  const translations: Record<string, string> = {
    SOURCE_CLOCK_MISMATCH: "参照データの時刻が一致していません",
    BASIS_BELOW_75: "Basis条件が基準値未満です",
    SIGN_CHANGED: "シグナル方向が途中で変化しました",
    NET_EDGE_BELOW_10: "手数料控除後の優位性が基準値未満です",
    ADVERSE_BASIS_MOVE: "Basisが不利な方向へ変化しました",
    SPREAD_OVER_20: "スプレッドが許容上限を超えています",
    DATA_UNAVAILABLE: "参照データを取得できません",
  };
  return translations[code] || `判定条件を満たしていません（${code}）`;
}

function buildV96Items(serviceActive: boolean, checkedAt: string, now: number) {
  const decision = readJson(CRYPTO_DECISION_PATH);
  const decisionUpdatedAt = runtimeTimestamp(decision);
  const targetWeights = asRecord(decision?.targetWeights);
  const coreSymbols = config.cryptoSymbols.filter((symbol) => symbol !== "PENGUUSDT");

  const items = coreSymbols.map((symbol) => {
    if (!serviceActive) return stoppedItem(symbol, "V96", checkedAt);
    if (!decision || !isFresh(decisionUpdatedAt, now)) {
      return unavailableItem(
        symbol,
        "V96",
        checkedAt,
        "V96実Runnerの判定スナップショットが欠損または古いため、発火候補を推測表示しません。",
        iso(decisionUpdatedAt),
      );
    }
    const weight = Number(targetWeights?.[symbol] ?? 0);
    const side: Side = weight > 0 ? "LONG" : weight < 0 ? "SHORT" : "WAIT";
    const activeTarget = side !== "WAIT";
    return {
      symbol,
      sleeve: "V96" as const,
      rank: 0,
      score: activeTarget ? 1 : 0,
      scoreMax: 1,
      status: activeTarget ? "発火候補" as const : "条件不足" as const,
      side,
      reason: activeTarget
        ? `V96実Runnerが${side === "LONG" ? "Long" : "Short"}目標を出力しています。注文前の全安全Gateは別途必要です。`
        : "V96実Runnerの現在目標は空です。新規発火条件は成立していません。",
      checkedAt,
      source: "V96 runner decision snapshot",
      dataUpdatedAt: iso(decisionUpdatedAt),
    };
  });

  const pengu = readJson(PENGU_V2_STATE_PATH);
  const penguUpdatedAt = runtimeTimestamp(pengu);
  if (!serviceActive) {
    items.push(stoppedItem("PENGUUSDT", "V96", checkedAt));
  } else if (!pengu || pengu.strategyId !== "PENGU_DUAL_LS_V2_FINAL" || !isFresh(penguUpdatedAt, now)) {
    items.push(unavailableItem(
      "PENGUUSDT",
      "V96",
      checkedAt,
      "PENGU_DUAL_LS_V2_FINALの実Runnerスナップショットが欠損・不一致・古いため、発火候補を推測表示しません。",
      iso(penguUpdatedAt),
    ));
  } else {
    const latestSignal = asRecord(pengu.latestSignal);
    const side = normalizeSide(latestSignal?.side);
    const targetGross = Number(latestSignal?.targetGross ?? 0);
    const activeTarget = side !== "WAIT" && Number.isFinite(targetGross) && targetGross > 0;
    items.push({
      symbol: "PENGUUSDT",
      sleeve: "V96",
      rank: 0,
      score: activeTarget ? 1 : 0,
      scoreMax: 1,
      status: activeTarget ? "発火候補" : "条件不足",
      side,
      reason: typeof latestSignal?.reason === "string" && latestSignal.reason.trim()
        ? latestSignal.reason
        : activeTarget
          ? "PENGU V2実Runnerが新規目標を出力しています。注文前の全安全Gateは別途必要です。"
          : "PENGU V2の確定1時間足Long/Short条件は未成立です。",
      checkedAt,
      source: "PENGU_DUAL_LS_V2_FINAL runner snapshot",
      dataUpdatedAt: iso(penguUpdatedAt),
    });
  }

  return items;
}

function buildV52Items(
  serviceActive: boolean,
  checkedAt: string,
  now: number,
  market: ReturnType<typeof newYorkMarketClock>,
) {
  const runtime = readV52Runtime(serviceActive, now);
  if (!market.open) {
    return { items: config.stockSymbols.map((symbol) => outsideMarketItem(symbol, checkedAt, market.label)), runtime };
  }
  if (!serviceActive) {
    return { items: config.stockSymbols.map((symbol) => stoppedItem(symbol, "V52", checkedAt)), runtime };
  }
  if (runtime.status !== "ACTIVE") {
    return {
      items: config.stockSymbols.map((symbol) => unavailableItem(
        symbol,
        "V52",
        checkedAt,
        v52RuntimeReason(runtime),
        runtime.updatedAt,
      )),
      runtime,
    };
  }

  const decision = readJson(STOCK_DECISION_PATH);
  const decisionUpdatedAt = runtimeTimestamp(decision);
  const decisionItems = Array.isArray(decision?.items) ? decision.items : null;
  if (!decision || !isFresh(decisionUpdatedAt, now) || !decisionItems) {
    return {
      items: config.stockSymbols.map((symbol) => decisionNotPublishedItem(
        symbol,
        checkedAt,
        runtime.updatedAt,
      )),
      runtime,
    };
  }

  return { items: config.stockSymbols.map((symbol) => {
    const bareSymbol = symbol.replace(/USDT$/, "");
    const sourceItem = decisionItems
      .map((item: unknown) => asRecord(item))
      .find((item) => item?.symbol === symbol || item?.symbol === bareSymbol);
    if (!sourceItem) {
      return unavailableItem(symbol, "V52", checkedAt, "この銘柄のV52実Runner判定が見つかりません。", iso(decisionUpdatedAt));
    }
    const side = normalizeSide(sourceItem.side);
    const accepted = sourceItem.status === "accepted" && side !== "WAIT";
    const reasons = Array.isArray(sourceItem.reasons)
      ? sourceItem.reasons.map(translateV52Reason)
      : [];
    return {
      symbol,
      sleeve: "V52" as const,
      rank: 0,
      score: accepted ? 1 : 0,
      scoreMax: 1,
      status: accepted ? "発火候補" as const : "条件不足" as const,
      side: accepted ? side : "WAIT" as const,
      reason: accepted
        ? "V52実Runnerが注文候補を出力しています。注文前の全安全Gateは別途必要です。"
        : reasons.length ? reasons.join("。") + "。" : "V52の発火条件は成立していません。",
      checkedAt,
      source: "V52 runner decision snapshot",
      dataUpdatedAt: iso(sourceItem.dataUpdatedAt ?? decisionUpdatedAt),
    };
  }), runtime };
}

export async function loadDecisionStatus(): Promise<DecisionStatusSnapshot> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.snapshot;

  const checkedAt = new Date(now).toISOString();
  const service = loadTradingService();
  const market = newYorkMarketClock(new Date(now));
  const v96Items = buildV96Items(service.active, checkedAt, now);
  const v52Snapshot = buildV52Items(service.active, checkedAt, now, market);
  v96Items.forEach((item, index) => { item.rank = index + 1; });
  v52Snapshot.items.forEach((item, index) => { item.rank = index + 1; });

  const snapshot: DecisionStatusSnapshot = {
    ok: service.state !== "UNKNOWN",
    readOnly: true,
    refreshIntervalMinutes: 1,
    checkedAt,
    source: "systemd + V96/PENGU V2/V52 runtime snapshots",
    service,
    v96: { items: v96Items },
    v52: {
      marketOpen: market.open,
      marketLabel: market.label,
      items: v52Snapshot.items,
      runtime: v52Snapshot.runtime,
    },
    error: service.state === "UNKNOWN" ? "LIVEサービス状態を確認できません。" : undefined,
  };

  cache = { expiresAt: now + CACHE_TTL_MS, snapshot };
  return snapshot;
}
