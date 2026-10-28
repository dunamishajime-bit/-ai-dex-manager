import {
  rankScoreDisplay,
  topRankedSymbols,
  type RankRow,
  type RealtimeTopSlot,
} from "./realtime-ranking";

export type RealtimeRankingPanel = {
  scope: string;
  title: string;
  slots: RealtimeTopSlot[];
  rankingContractAvailable: boolean;
};

const LOGIC_TITLES: Record<string, string> = {
  MARKET: "全取り扱い通貨",
  V12_V4: "V12 V4",
  Q102: "Q102",
  PENGU: "PENGU",
  FET: "FET",
  HYPE: "HYPE",
  V52: "V52",
  "Idle Long": "Idle Long",
  "Idle Short": "Idle Short",
};

function scopeForLogic(logic: string) {
  return logic === "V12" ? "V12_V4" : logic;
}

function titleForScope(scope: string) {
  return LOGIC_TITLES[scope] ?? scope;
}

/**
 * Builds display panels only from each strategy's own rank contract. ALL never
 * compares scores from different models; V12 V4 is always shown as explicitly
 * unevaluated until it publishes a causal live-ranking contract.
 */
export function buildRealtimeRankingPanels(rows: RankRow[], selectedLogic = "ALL"): RealtimeRankingPanel[] {
  const selectedScope = selectedLogic === "ALL" ? null : scopeForLogic(selectedLogic);
  const scopes = selectedScope ? [selectedScope] : ["MARKET"];

  return scopes.map((scope) => {
    const scopedRows = rows.filter((row) => row.rankingScope === scope);
    const rankingContractAvailable = scopedRows.some((row) => row.rankingContractAvailable === true);
    return {
      scope,
      title: titleForScope(scope),
      slots: topRankedSymbols(scopedRows, scope),
      rankingContractAvailable,
    };
  });
}

/** Stable namespacing prevents independent strategy panels from sharing movement identities.
 * In the all-currency MARKET view every ranked currency participates so rise/fall
 * waves are not accidentally limited to the Top 3 cards.
 */
export function rankingFeedbackRows(panels: RealtimeRankingPanel[], rankedRows: RankRow[] = []): RankRow[] {
  if (panels.some((panel) => panel.scope === "MARKET")) {
    return rankedRows
      .filter((row) => row.rankingScope === "MARKET" && row.rankingEligible === true && Number.isInteger(row.rank) && Number(row.rank) > 0)
      .sort((a, b) => Number(a.rank) - Number(b.rank))
      .map((row) => ({ ...row, id: `MARKET::${row.id}`, rankingScope: "MARKET" }));
  }
  return panels.flatMap((panel) => panel.slots.flatMap((slot) => {
    if (slot.status !== "CANDIDATE" || !slot.sourceRow) return [];
    return [{
      ...slot.sourceRow,
      id: `${panel.scope}::${slot.sourceRow.id}`,
      rank: slot.slot,
      rankingScope: panel.scope,
    }];
  }));
}

export function rankingMovementId(scope: string, row: RankRow) {
  return `${scope}::${row.id}`;
}

export function scoreKindLabel(row: RankRow): string {
  if (row.scoreKind === "MARKET") return row.scoreLabel || "Aster共通市場Score（参考・非発注）";
  if (row.scoreKind === "NATIVE") return row.scoreLabel || "実測スコア";
  if (row.scoreKind === "GATE_COMPLETION") return row.scoreLabel || "Gate充足度（発火確率ではありません）";
  if (row.logic === "V12_V4" && row.fresh && row.sourceStatus === "NOT_EVALUATED" && row.reason.includes("NO_NATIVE_ENTRY_CANDIDATES")) {
    return "判定済み（候補なし / native score未提供）";
  }
  if (row.sourceStatus === "STALE" || !row.fresh) return "未評価（STALE / 発注不可）";
  if (row.sourceStatus === "SOURCE_ERROR") return "未評価（観測取得エラー）";
  return row.scoreLabel && !/native score has no verified/i.test(row.scoreLabel)
    ? `未評価（${row.scoreLabel}）`
    : "未評価（有効なスコアを取得できていません）";
}

export function scoreValueLabel(row: RankRow, fetchFailed = false): string {
  if (fetchFailed || row.score === null || !Number.isFinite(row.score)) return "—";
  return rankScoreDisplay(row.score);
}

export function topSlotStatusLabel(slot: RealtimeTopSlot): string {
  switch (slot.status) {
    case "CANDIDATE": return "順位観測あり";
    case "NO_CANDIDATE": return "本日判定済み / 条件適合候補なし";
    case "STALE": return "STALE / 発注不可";
    case "SOURCE_ERROR": return "観測取得エラー / 順位未評価";
    case "NOT_EVALUATED": return "順位未評価 / 判定データ未取得";
  }
}
