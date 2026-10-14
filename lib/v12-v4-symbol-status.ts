import { DIST_TERMINAL_LIVE_CONFIG } from "@/lib/disterminal-live-config";
import type { V12V4HpSnapshot } from "@/lib/v12-v4-hp-contract";

type MarketRow = {
  symbol?: string;
  logic?: string;
  fresh?: boolean;
  checkedAt?: number;
  score?: number | null;
  scoreKind?: string;
  sourceFeatures?: Record<string, number | boolean>;
  v4Reference?: {marketBaseScore:number;v4GateBonus:number};
};

export type MarketRankingResponse = {
  readOnly?: boolean;
  tradingMutation?: number;
  runtimeSha?: string;
  rows?: MarketRow[];
};

export type V12V4SymbolDisplayRow = {
  symbol: string;
  state: "CANDIDATE" | "FILTERED" | "NO_EMISSION" | "SOURCE_UNAVAILABLE";
  side: "LONG" | "SHORT" | null;
  routes: string[];
  filteredReasons: string[];
  message: string;
  marketScore: number | null;
  realtimeScore: number | null;
  v4GateBonus: number;
  marketFeatures: Record<string, number>;
  marketFresh: boolean;
};

/** Configuration is only the symbol inventory, NEVER a substitute for V4's live decision. */
export const V12V4_SYMBOL_INVENTORY = [...DIST_TERMINAL_LIVE_CONFIG.v12Symbols];

function numericFeatures(features: MarketRow["sourceFeatures"]): Record<string, number> {
  const normalized: Record<string, number> = {};
  if (!features) return normalized;
  for (const [key, value] of Object.entries(features)) {
    if (typeof value === "number" && Number.isFinite(value)) normalized[key] = value;
  }
  return normalized;
}

/**
 * Join two independently labeled read-only sources.
 * A market-only score can NEVER upgrade a missing native V4 decision to PASS/BLOCK.
 */
export function v12V4SymbolDisplayRows(
  snapshot: V12V4HpSnapshot | null,
  ranking: MarketRankingResponse | null,
  now = Date.now(),
): V12V4SymbolDisplayRow[] {
  const v4Ready = snapshot?.displayStatus === "LIVE_VERIFIED"
    && snapshot.actual.v12PrimaryMode === "V4"
    && snapshot.actual.legacyV12RunnerActive === false
    && snapshot.freshness.decision === true;
  const marketSourceValid = ranking?.readOnly === true
    && ranking.tradingMutation === 0
    && !!snapshot?.actual.currentReleaseSha
    && ranking.runtimeSha === snapshot.actual.currentReleaseSha;
  const marketRows = new Map<string, MarketRow>();
  if (marketSourceValid) for (const row of ranking?.rows ?? []) {
    if (row.logic !== "MARKET" || !row.symbol || (row.scoreKind !== "MARKET" && row.scoreKind !== "MARKET_PLUS_V4") || row.fresh !== true
      || typeof row.checkedAt !== "number" || now - row.checkedAt < -60_000
      || now - row.checkedAt > 120_000) continue;
    marketRows.set(row.symbol.toUpperCase(), row);
  }

  const symbols = new Set<string>(V12V4_SYMBOL_INVENTORY);
  if (v4Ready && snapshot) {
    for (const row of [...snapshot.candidates, ...snapshot.filtered]) {
      if (/^[A-Z0-9]{2,20}USDT$/.test(row.symbol)) symbols.add(row.symbol);
    }
  }

  return [...symbols].map((symbol) => {
    const candidates = v4Ready ? snapshot!.candidates.filter((row) => row.symbol === symbol) : [];
    const filtered = v4Ready ? snapshot!.filtered.filter((row) => row.symbol === symbol) : [];
    const m = marketRows.get(symbol);
    const validScore = m && typeof m.score === "number" && Number.isFinite(m.score)
      && m.score >= 0 && m.score <= 100 ? m.score : null;
    const marketScore = m?.v4Reference?.marketBaseScore ?? validScore;
    const v4GateBonus = m?.v4Reference?.v4GateBonus ?? 0;
    const firstSide = candidates[0]?.side ?? filtered[0]?.side;
    const side = firstSide === "LONG" || firstSide === "SHORT" ? firstSide : null;
    const state: V12V4SymbolDisplayRow["state"] =
      candidates.length ? "CANDIDATE" :
      filtered.length ? "FILTERED" :
      v4Ready ? "NO_EMISSION" : "SOURCE_UNAVAILABLE";
    const routes = [...new Set([...candidates.map((c) => c.route), ...filtered.map((f) => f.route)])];
    const filteredReasons = [...new Set(filtered.map((row) => row.reason))];
    const message = state === "CANDIDATE"
      ? "V4の候補出力を観測。発注成立には別の共有リスク・容量・注文Gateが必要です。"
      : state === "FILTERED"
        ? "V4のfiltered出力を観測。通過しなかった理由は展開欄に表示します。"
        : state === "NO_EMISSION"
          ? "今回のV4 sourceに候補・filtered出力なし。個別Gateが評価完了した証明ではありません。"
          : "V4の通貨別判定snapshotが未取得です。PASS・BLOCK・LONG・SHORTを推測しません。";
    return {
      symbol, state, side, routes, filteredReasons, message,
      marketScore,
      realtimeScore:validScore,v4GateBonus,
      marketFeatures: validScore === null ? {} : numericFeatures(m?.sourceFeatures),
      marketFresh: validScore !== null,
    };
  });
}
