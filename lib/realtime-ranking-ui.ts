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
  const scopes = selectedScope
    ? [selectedScope]
    : ["V12_V4", ...new Set(rows
      .filter((row) => row.rankingContractAvailable === true && typeof row.rankingScope === "string")
      .map((row) => row.rankingScope!)
      .filter((scope) => scope !== "V12_V4"))];

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

/** Stable namespacing prevents independent strategy panels from sharing movement identities. */
export function rankingFeedbackRows(panels: RealtimeRankingPanel[]): RankRow[] {
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
  if (row.scoreKind === "NATIVE") return row.scoreLabel || "実測スコア";
  if (row.scoreKind === "GATE_COMPLETION") return row.scoreLabel || "Gate充足度（発火確率ではありません）";
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
