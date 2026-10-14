'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, RefreshCw, Trophy, X } from 'lucide-react';
import Link from 'next/link';

import {
  currentRankRow,
  executionBlocked,
  rankChanges,
  rankRows,
  nextRealtimeRankingAt,
  type RankRow,
  type RealtimeTopSlot,
} from '@/lib/realtime-ranking';
import {
  buildRealtimeRankingPanels,
  rankingFeedbackRows,
  rankingMovementId,
  scoreKindLabel,
  scoreValueLabel,
  topSlotStatusLabel,
  type RealtimeRankingPanel,
} from '@/lib/realtime-ranking-ui';
import type { V12V4HpSnapshot } from '@/lib/v12-v4-hp-contract';
import { rankingStrategyBadges } from '@/lib/realtime-ranking-strategy-display';
import { SignalGateList } from './SignalGateList';
import { useRealtimeRankingFeedback } from '@/hooks/useRealtimeRankingFeedback';

type V12V4Summary = Pick<V12V4HpSnapshot,
  'target' | 'displayStatus' | 'actual' | 'timestamps' | 'freshness' | 'routeCoverage' | 'errors' | 'readOnly' | 'tradingMutation'>;
type Snapshot = {
  checkedAt: number;
  runtimeSha: string;
  rows: RankRow[];
  metric: string;
  errors: Record<string, string>;
  v12V4?: V12V4Summary;
  v4GateReference?: { verified:boolean; decisionTs:number|null; maximumBonus:number; source:string };
};

function missing(row: RankRow) {
  if (row.logic === 'MARKET') return row.reason;
  return row.gates.filter((gate) => gate.kind !== 'execution' && gate.state !== 'OK')
    .map((gate) => gate.label + '：' + gate.detail).join(' / ') || 'Signal Gateの不足情報なし（発注可を意味しません）';
}

function constraints(row: RankRow) {
  return row.gates.filter((gate) => gate.kind === 'execution' && gate.state === 'NO')
    .map((gate) => gate.label + '：' + gate.detail).join(' / ');
}

function blockReason(row: RankRow) {
  return row.gates.filter((gate) => gate.kind === 'execution' && gate.state === 'NO')
    .map((gate) => gate.key === 'clock' || gate.label === 'S34_4H_GRID'
      ? '受付時間外'
      : gate.label === 'FET保有・保留注文' ? '保有・注文あり'
        : gate.label === '同時候補の選定' ? 'Runner選定未通過' : gate.label)
    .join(' / ');
}

function rankExplanation(row: RankRow) {
  if (row.logic === 'MARKET') return row.score === null ? 'Asterの価格・確定足が不足しScore未評価です。' : row.v4Reference ? `共通市場Score ${row.v4Reference.marketBaseScore.toFixed(2)} + V12 V4実Runner Gate参考加点 ${row.v4Reference.v4GateBonus}。発注判断、勝率、利益予測とは無関係です。` : 'Aster共通市場Scoreのみ。V12 V4正式Gateの有効な実測がないため参考加点は行っていません。';
  if (!row.fresh || row.sourceStatus === 'STALE') return '観測がSTALEのため現在の順位・判定は未評価です。発注不可です。';
  if (row.sourceStatus === 'SOURCE_ERROR') return '観測取得に失敗しました。Scoreや順位を推測していません。';
  if (row.score === null) return '必要なデータまたは実測スコアが未取得のため順位対象外です。';
  if (row.score === 0) return 'Score 0は実測値として一覧に表示しますが、Top3順位対象外です。';
  if (row.rankingEligible && row.rankingScope) return `${row.rankingScope}内の順位契約による順位です。他ロジックとは尺度・順位を比較しません。`;
  if (executionBlocked(row)) return `これは表示上の観測候補で、発注不可です。理由：${blockReason(row)}`;
  if (row.scoreKind === 'GATE_COMPLETION') return 'Signal Gateの充足度です。発火確率・利益予測ではありません。';
  return 'ロジック固有の実測値です。順位契約がないためTop3順位には使いません。';
}

function Movement({ delta }: { delta?: number }) {
  if (delta === 0) return <span className="text-[9px] text-[#efd58c]">NEW</span>;
  if (!delta) return null;
  return <span className={'inline-flex items-center text-[9px] ' + (delta > 0 ? 'text-emerald-300' : 'text-rose-300')}>
    {delta > 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />} {Math.abs(delta)}
  </span>;
}

function statusText(slot: RealtimeTopSlot, refreshFailed: boolean) {
  if (refreshFailed && slot.status === 'CANDIDATE') return '前回成功観測を表示中 / 発注可否は未保証';
  return topSlotStatusLabel(slot);
}

function v4PanelSummary(panel: RealtimeRankingPanel, data?: Snapshot | null) {
  if (panel.scope !== 'V12_V4') return null;
  const summary = data?.v12V4;
  if (!summary) return <p className="panel-source-note">V4 runtime / decision source 未取得。41 routesの評価完了とは表示しません。</p>;
  return <div className="panel-source-note" data-v4-summary>
    <span>Target {summary.target.policyId} · Runtime {summary.displayStatus}</span>
    <span>出力route {summary.routeCoverage.observed}/{summary.routeCoverage.expected}（route出現数。全41 route評価完了を意味しません）</span>
    <span>Decision {summary.timestamps.decisionTs ? new Date(summary.timestamps.decisionTs).toLocaleString('ja-JP') : '未取得'} · fresh {summary.freshness.decision ? 'yes' : 'no'}</span>
    {summary.actual.activeRunnerSha && <span>Runner SHA {summary.actual.activeRunnerSha.slice(0, 12)}… · {summary.actual.activeRunnerState}</span>}
    {summary.errors.length > 0 && <span className="text-amber-200">{summary.errors.join(' / ')}</span>}
    <span>V4 decision sourceにはLIVE順位・native scoreがないため、順位未評価です。</span>
  </div>;
}

export function RealtimeRankingBoard() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [logic, setLogic] = useState('ALL');
  const [side, setSide] = useState('ALL');
  const [search, setSearch] = useState('');
  const [remaining, setRemaining] = useState(30);
  const [changes, setChanges] = useState<Record<string, number>>({});
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const previous = useRef<Record<string, string[]>>({});
  const prepareFeedback = useRef<() => void>(() => {});
  const hasData = useRef(false);
  const requesting = useRef(false);
  const alive = useRef(true);
  const next = useRef(nextRealtimeRankingAt(Date.now()));
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  const dialog = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    if (requesting.current) return;
    requesting.current = true;
    setBusy(true);
    try {
      const response = await fetch('/api/system/realtime-ranking', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.error || '取得失敗');
      if (!alive.current) return;

      const observed = rankRows((result.rows as RankRow[]).map((row) => currentRankRow(row, Date.now())));
      const allPanels = buildRealtimeRankingPanels(observed, 'ALL');
      const nextByScope: Record<string, string[]> = {};
      const movement: Record<string, number> = {};
      for (const panel of allPanels) {
        const ids = rankingFeedbackRows([panel]).map((row) => row.id);
        nextByScope[panel.scope] = ids;
        for (const [id, delta] of Object.entries(rankChanges(previous.current[panel.scope] ?? [], ids))) {
          movement[id] = delta;
        }
      }

      if (hasData.current) prepareFeedback.current();
      previous.current = nextByScope;
      setChanges(movement);
      setFlash(movement);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash({}), 2200);
      setData(result as Snapshot);
      setRevision((value) => value + 1);
      hasData.current = true;
      setError('');
    } catch (caught) {
      if (alive.current) {
        setError(caught instanceof Error ? caught.message : '取得失敗');
        setFlash({});
      }
    } finally {
      requesting.current = false;
      if (alive.current) {
        setBusy(false);
        next.current = nextRealtimeRankingAt(Date.now());
        setRemaining(30);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const timer = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((next.current - Date.now()) / 1000)));
      if (Date.now() >= next.current) void load();
    }, 1000);
    return () => {
      alive.current = false;
      clearInterval(timer);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [load]);

  const all = rankRows((data?.rows ?? []).map((row) => currentRankRow(row, Date.now())));
  const strategyRowsForSymbol = (symbol: string) => all
    .filter((candidate) => candidate.logic !== 'MARKET' && candidate.symbol === symbol)
    .sort((a, b) =>
      Number(b.fresh) - Number(a.fresh) ||
      a.logic.localeCompare(b.logic) ||
      a.side.localeCompare(b.side));
  const strategyRowsFor = (row: RankRow) => row.logic === 'MARKET' ? strategyRowsForSymbol(row.symbol) : [row];
  const strategyBadgesFor = (row: RankRow) => rankingStrategyBadges(row.symbol, strategyRowsFor(row));
  const logicLabel = (value: string) => value === 'V12_V4' ? 'V12 V4' : value;
  const filtered = all.filter((row) => {
    const linked = strategyBadgesFor(row);
    const searchText = [
      row.symbol,
      row.logic,
      row.side,
      row.sourceRoute ?? '',
      ...linked.flatMap((candidate) => [candidate.logic, candidate.side, ...candidate.sourceRoutes]),
    ].join(' ').toLowerCase();
    return (logic === 'ALL' ? row.logic === 'MARKET' : row.logic === logic) &&
      (logic === 'ALL' || side === 'ALL' || row.side === side) &&
      searchText.includes(search.toLowerCase());
  }).sort((a,b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || a.symbol.localeCompare(b.symbol));
  const panels = error && !data ? [] : buildRealtimeRankingPanels(all, logic);
  const feedbackRows = rankingFeedbackRows(panels, filtered);
  const selected = all.find((row) => row.id === selectedId);
  const feedback = useRealtimeRankingFeedback(feedbackRows, revision, logic + '|' + side + '|' + search, error);
  prepareFeedback.current = feedback.prepare;

  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open) dialog.current.showModal();
    else if (!selected && dialog.current?.open) dialog.current.close();
  }, [selected]);

  const renderStrategyBadges = (row: RankRow, compact = false) => {
    const linked = strategyBadgesFor(row);
    if (!linked.length) {
      return <span className="rank-strategy-empty" title="取引ロジックの紐付けが現在の判定・設定資料から確認できません">ロジック未確認</span>;
    }
    return <span className={'rank-strategy-badges ' + (compact ? 'rank-strategy-badges-compact' : '')}>
      {linked.map((candidate) => {
        const configOnly = candidate.source === 'CONFIG_ONLY';
        const direction = configOnly ? '未判定' : candidate.side === 'UNKNOWN' ? '方向未取得' : candidate.side;
        const tone = configOnly || !candidate.fresh ? 'rank-strategy-wait' : direction === 'LONG' ? 'rank-strategy-long' : direction === 'SHORT' ? 'rank-strategy-short' : 'rank-strategy-wait';
        const description = configOnly
          ? '監視設定上の候補。現行Productionでの登録・方向は未照合'
          : candidate.fresh ? '最新のロジック観測（発注条件成立を意味しません）' : '古いロジック観測。現在の方向は未確認';
        return <span
          key={row.id + ':' + candidate.logic + ':' + candidate.side}
          className={'rank-strategy-badge ' + tone + (!candidate.fresh ? ' rank-strategy-stale' : '')}
          data-strategy-logic={candidate.logic}
          data-strategy-side={candidate.side}
          data-strategy-source={candidate.source}
          title={logicLabel(candidate.logic) + ' ' + direction + ' / ' + description + (candidate.sourceRoutes.length ? ' / Route: ' + candidate.sourceRoutes.join(', ') : '')}
        >
          <b>{logicLabel(candidate.logic)}</b>
          <em>{direction}</em>
          {configOnly ? <small>設定候補</small> : !candidate.fresh ? <small>STALE</small> : null}
        </span>;
      })}
    </span>;
  };

  const cell = (row: RankRow) => {
    const movementId = rankingMovementId(row.rankingScope ?? row.logic, row);
    const strategySummary = strategyBadgesFor(row).map((candidate) => logicLabel(candidate.logic) + ' ' + (candidate.source === 'CONFIG_ONLY' ? '未判定（設定候補）' : candidate.side)).join(' / ') || 'ロジック紐付け未確認';
    const sourceDetails = [
      row.sourceRoute ? `Route ${row.sourceRoute}` : '',
      row.sourceRank && row.logic !== 'MARKET' ? `Source rank ${row.sourceRank}（LIVE順位ではありません）` : '',
      row.sourceFeatures && Object.keys(row.sourceFeatures).length
        ? `Source features ${Object.entries(row.sourceFeatures).map(([key, value]) => `${key}=${value}`).join(' / ')}` : '',
    ].filter(Boolean).join(' · ');
    const reason = [row.reason, constraints(row), missing(row), sourceDetails].filter(Boolean).join(' / ');
    return <button
      key={row.id}
      type="button"
      id={'row-' + row.id}
      data-ranking-row={row.id}
      ref={(node) => feedback.register('row:' + movementId, node)}
      onClick={() => setSelectedId(row.id)}
      title={`${row.symbol} / ${strategySummary} / ${rankExplanation(row)} / ${reason}`}
      className={'rank-cell ' + (flash[movementId] !== undefined ? 'rank-flash ' : '') +
        (row.score === 0 ? 'rank-score-zero ' : '') +
        (!row.fresh || error ? 'rank-unknown ' : executionBlocked(row) ? 'rank-blocked' : 'rank-observed')}
    >
      <span className="text-[#d9bd74]">{error ? '—' : row.rankingEligible ? row.rank ?? '—' : '—'}</span>
      <span className="rank-symbol flex min-w-0 items-center gap-1 font-semibold text-white">
        <span className="min-w-0 truncate">{row.symbol.replace(/USDT$/, '')}</span>
        {executionBlocked(row) && <span className="rank-order-block truncate text-[8px] font-normal text-rose-300">発注不可: {blockReason(row)}</span>}
      </span>
      {renderStrategyBadges(row)}
      <span className="rank-score-cell min-w-0 text-right font-mono font-bold text-[#ead7a4]" title={scoreKindLabel(row)}>
        <span>{scoreValueLabel(row, !!error)}</span>
        <small className="block truncate font-sans font-normal text-white/50">{row.score === null ? '未評価' : row.scoreKind === 'MARKET_PLUS_V4' ? '市場＋V4参考' : row.scoreKind === 'MARKET' ? '市場Score' : row.scoreKind === 'NATIVE' ? '実測値' : 'Gate充足度'}</small>
      </span>
    </button>;
  };

  const renderSlot = (panel: RealtimeRankingPanel, slot: RealtimeTopSlot) => {
    const row = slot.sourceRow;
    const status = statusText(slot, !!error);
    if (!row) return <div
      key={`${panel.scope}-${slot.slot}`}
      role="listitem"
      data-top-slot={slot.slot}
      data-slot-status={slot.status}
      aria-label={`${panel.title} 上位3の${slot.slot}位: ${status}`}
      className="radar-leader radar-leader-placeholder"
    >
      <div className="flex items-start gap-2"><Trophy size={14} className="mt-0.5 shrink-0 text-white/35"/><span className="slot-number">{slot.slot}</span><div className="min-w-0">
        <strong>{status}</strong>
        <p>{slot.status === 'NO_CANDIDATE' ? 'このcycleの順位判定は取得済みです。' : '候補や順位を推測で補完していません。'}</p>
      </div></div>
    </div>;

    const movementId = rankingMovementId(panel.scope, row);
    const blocked = executionBlocked(row);
    return <div
      key={`${panel.scope}-${slot.slot}-${row.id}`}
      role="listitem"
      data-top-slot={slot.slot}
      data-slot-status={slot.status}
      aria-label={`${panel.title} 上位3の${slot.slot}位: ${row.symbol}, ${status}`}
      className={'radar-leader ' + (flash[movementId] !== undefined ? 'rank-flash' : '')}
    >
      <button
        type="button"
        data-ranking-leader={movementId}
        ref={(node) => feedback.register('leader:' + movementId, node)}
        onClick={() => setSelectedId(row.id)}
        aria-label={`${panel.title} ${slot.slot}位 ${row.symbol} 詳細`}
        className="radar-leader-button"
      >
        <div className="radar-leader-heading">
          <div className="radar-leader-identity"><Trophy size={13} className="shrink-0 text-[#d8bd75]"/><span className="slot-number">{slot.slot}</span><strong>{row.symbol}</strong><span>{row.logic === 'MARKET' ? '共通市場' : row.side === 'LONG' ? 'Long' : row.side === 'SHORT' ? 'Short' : '方向未評価'}</span></div>
          <Movement delta={changes[movementId]}/>
        </div>
        <div className="radar-score-line"><b>{scoreValueLabel(row, !!error)}</b><span>{scoreKindLabel(row)}</span></div>
        <div className="radar-leader-strategies">{renderStrategyBadges(row, true)}</div>
        <p className="radar-source-route">{row.logic === 'MARKET' ? (row.v4Reference ? '市場Score＋V4参考Gate加点順' : 'Aster市場Score順') : row.sourceRoute ? `Route: ${row.sourceRoute}` : `${row.logic} strategy rank`}</p>
        <p className={blocked ? 'radar-slot-warning' : 'radar-slot-note'}>{row.logic === 'MARKET' ? '参考市場ランキング。発注条件とは無関係です。' : blocked ? `発注不可: ${blockReason(row)}` : '順位観測です。発注可否は別途Runnerが判定します。'}</p>
        <p className="radar-slot-reason">{row.reason || missing(row)}</p>
        <time dateTime={new Date(row.checkedAt).toISOString()}>観測 {new Date(row.checkedAt).toLocaleTimeString('ja-JP')}</time>
      </button>
    </div>;
  };

  return <div className="compact-radar">
    <header className="radar-heading"><div className="flex min-w-0 items-center gap-3"><h1 className="shrink-0 text-sm font-bold text-[#e9d9a0]">リアルタイム判定 Ranking</h1><span className="hidden truncate text-[10px] text-white/40 sm:block">{data ? new Date(data.checkedAt).toLocaleTimeString('ja-JP') : '取得中'} · {data?.rows.length ?? '—'}観測行 · 30秒更新</span></div><button disabled={busy} onClick={() => void load()} className="flex shrink-0 items-center gap-1 rounded-lg border border-[#a68948]/30 px-2 py-1 text-[10px] text-[#efdda7] disabled:opacity-50"><RefreshCw size={11} className={busy ? 'animate-spin' : ''}/>{busy ? '更新中' : '更新'} · {remaining}秒</button></header>
    {error && <p role="alert" className="rounded-lg bg-rose-400/10 px-2 py-1 text-xs text-rose-200">{error}。前回成功観測を表示しています。順位は発注許可を意味しません。</p>}
    {!!data && Object.keys(data.errors).length > 0 && <p role="status" className="text-[10px] text-amber-200">未確認：{Object.keys(data.errors).join(' / ')}</p>}

    <div className="radar-feedback" aria-label="順位変動の効果音とアニメーション">
      <button type="button" aria-pressed={feedback.soundEnabled} onClick={feedback.toggleSound} className={feedback.soundEnabled ? 'feedback-on' : ''}>効果音 {feedback.soundEnabled ? 'ON' : 'OFF'}</button>
      <button type="button" aria-pressed={feedback.motionEnabled} onClick={feedback.toggleMotion} className={feedback.motionEnabled ? 'feedback-on' : ''}>移動アニメ {feedback.motionEnabled ? 'ON' : 'OFF'}</button>
      {(['rise', 'fall', 'top3'] as const).map((role) => <label key={role} className="feedback-select"><span>{role === 'rise' ? '上昇' : role === 'fall' ? '下降' : 'Top3'}</span><select aria-label={(role === 'rise' ? '上昇' : role === 'fall' ? '下降' : 'Top3') + '効果音'} value={feedback.soundIds[role]} onChange={(event) => feedback.selectSound(role, event.target.value)}>{feedback.rankingSoundsForRole(role).map((sound) => <option key={sound.id} value={sound.id}>{sound.label}</option>)}</select><button type="button" aria-label={(role === 'rise' ? '上昇' : role === 'fall' ? '下降' : 'Top3') + '音を試聴'} onClick={() => feedback.testSound(role)}>試聴</button></label>)}
      <span role="status" aria-live="polite" className="feedback-notice">{feedback.audioNotice || '0は実測表示のみ。順位・Top3・演出対象外です。'}</span>
    </div>

    <div className="radar-filters"><input aria-label="通貨を検索" placeholder="通貨・ロジック検索" value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1"/><select aria-label="ロジック" value={logic} onChange={(event) => {setLogic(event.target.value); setSide('ALL');}}><option value="ALL">全通貨スコア順</option>{[...new Set(data?.rows.filter((row) => row.logic !== "MARKET").map((row) => row.logic) ?? [])].map((value) => <option key={value} value={value}>{value === 'V12_V4' ? 'V12 V4' : value}</option>)}</select><select aria-label="方向" disabled={logic === "ALL"} value={side} onChange={(event) => setSide(event.target.value)}><option value="ALL">全方向</option><option>LONG</option><option>SHORT</option><option>WAIT</option></select></div>

    <div className="radar-panel-list" aria-label="全通貨ランキングまたは戦略別順位">
      {panels.map((panel) => <section key={panel.scope} aria-label={`${panel.title} 上位3`} className="radar-panel" data-ranking-scope={panel.scope}>
        <header className="radar-panel-heading"><div><h2>{panel.scope === "MARKET" ? "全通貨 共通Score Top 3" : panel.title + " · strategy-scoped Top 3"}</h2><p>{panel.scope === "MARKET" ? "全取扱通貨を同じAster相場指標で比較。スコアは表示専用、取引判定に不使用。" : panel.rankingContractAvailable ? "ロジック固有の順位契約。別ロジックのScoreとは比較しません。" : "LIVE順位契約未取得。別ロジックのScoreやResearch順位で補完しません。"}</p></div><span>{panel.rankingContractAvailable ? 'RANK SOURCE' : '順位未評価'}</span></header>
        {v4PanelSummary(panel, data)}
        <div role="list" aria-label={`${panel.title} 上位3枠`} className="radar-leaders">{panel.slots.map((slot) => renderSlot(panel, slot))}</div>
      </section>)}
      {!panels.length && <p className="p-3 text-xs text-white/50">順位契約に基づくTop 3はありません。全観測値は下の一覧に表示します。</p>}
    </div>

    <section aria-label="全監視通貨・ロジック" className="radar-ranking"><div className="radar-inventory-heading"><h2>{logic === "ALL" ? "全取り扱い通貨 · Score高い順" : logic + " 観測値 · Score順"} · 有効 {filtered.filter((row) => row.score !== null).length} / 全 {filtered.length}件</h2><span title={data?.metric}>市場Score＋V4正式Gate参考加点 {data?.v4GateReference?.verified ? '有効' : '未取得・加点なし'} · 発注非連動 · クリックで内訳</span></div><p className="radar-inventory-note">{logic === "ALL" ? "Aster市場Score（Trend25 / Momentum20 / BTC相対強度15 / Volume10 / Structure10 / RiskFit5 / Bonus15）に、同一SHA・確定足で検証できたV12 V4 Gateの参考加点（最大15点）を対象通貨にのみ加えて順位表示。未取得は加点0。正式発火Scoreではありません。" : "ロジック固有の観測値を表示。共通市場Scoreとは異なる尺度です。"} 0も実測値なら表示し、未取得とは区別します。</p>
      <div className="radar-columns">{[0, 1, 2].map((column) => <div key={column} className="radar-column"><div className="rank-column-heading"><span>順位</span><span>通貨</span><span>ロジック / 判定方向</span><span>Score / 尺度</span></div><div className="rank-column-body">{filtered.slice(column * 15, column * 15 + 15).map(cell)}</div></div>)}</div>
      {filtered.length > 45 && <div className="radar-tail" aria-label="46位以降">{filtered.slice(45).map(cell)}</div>}
      {data && !filtered.length && <p className="p-3 text-xs text-white/45">該当する観測行はありません。</p>}
    </section>

    <dialog ref={dialog} aria-labelledby="rank-detail-title" onCancel={() => setSelectedId(null)} className="rank-dialog">{selected && <><div className="flex items-center justify-between gap-3 border-b border-white/10 p-4"><h2 id="rank-detail-title" className="text-lg font-bold text-[#ead7a4]">{selected.symbol.replace(/USDT$/, '')} · {selected.logic} · {selected.side}</h2><button autoFocus type="button" aria-label="詳細を閉じる" onClick={() => setSelectedId(null)} className="rounded-lg border border-white/15 p-2 text-white"><X size={16}/></button></div><div className="overflow-y-auto p-4"><p className="mb-3 text-xs text-white/60">観測 {new Date(selected.checkedAt).toLocaleString('ja-JP')} ／ 順位 {selected.rankingEligible ? selected.rank ?? '—' : '対象外'} ／ Score {scoreValueLabel(selected, !!error)} · {scoreKindLabel(selected)}</p><p className="mb-3 rounded-lg border border-[#a68948]/30 bg-[#d6b662]/5 p-3 text-xs leading-relaxed text-[#ead7a4]">{rankExplanation(selected)}</p><p className="mb-3 text-xs text-[#dbc787]">{constraints(selected) || missing(selected)}</p>{selected.sourceRoute && <p className="mb-2 break-words text-xs text-white/60">Source route: {selected.sourceRoute} {selected.sourceRank ? `· Research順位 ${selected.sourceRank}（LIVE順位ではありません）` : ''}</p>}{selected.sourceFeatures && <pre className="mb-3 whitespace-pre-wrap break-words text-[10px] text-white/55">{JSON.stringify(selected.sourceFeatures, null, 2)}</pre>}<SignalGateList gates={error ? selected.gates.map((gate) => ({ ...gate, state: 'UNKNOWN', detail: '更新失敗：前回観測' })) : selected.gates}/>{selected.href && <Link href={selected.href} className="mt-4 inline-block text-xs text-[#dbc787]">{selected.logic} 詳細ページ →</Link>}</div></>}</dialog>

    <style jsx global>{`
      .compact-radar{min-height:560px;min-width:0;display:flex;flex-direction:column;gap:6px;overflow-x:hidden}
      .radar-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;flex-shrink:0;padding:5px 8px;border:1px solid #a6894833;border-radius:10px;background:#13140f}
      .radar-feedback{display:flex;align-items:center;flex-wrap:wrap;gap:5px;min-width:0;flex-shrink:0;padding:5px 7px;border:1px solid #ffffff13;border-radius:9px;background:#080d15;color:#d8d2be;font-size:10px}.radar-feedback>button,.feedback-select button{border:1px solid #ffffff25;border-radius:6px;padding:3px 6px;background:#ffffff06;color:#c7cbd1;white-space:nowrap}.radar-feedback .feedback-on{border-color:#c7ab5c88;background:#c7ab5c12;color:#f3e3ac}.feedback-select{display:flex;align-items:center;gap:3px;border:1px solid #b99c5040;border-radius:6px;padding:2px 4px;color:#e7cf8b;white-space:nowrap}.feedback-select select{max-width:min(145px,28vw);min-width:0;border-radius:4px;padding:3px 2px;background:#20291c;color:white;font-size:10px}.feedback-notice{min-width:0;flex:1;color:#9aa6b5;font-size:9px;overflow-wrap:anywhere}
      .radar-filters{display:flex;gap:5px;min-width:0;flex-shrink:0}.radar-filters input,.radar-filters select{min-width:0;height:28px;padding:2px 7px;border:1px solid #ffffff18;border-radius:7px;background:#090e16;color:#eee;font-size:10px}
      .radar-panel-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:7px;min-width:0;flex-shrink:0}.radar-panel{min-width:0;overflow:hidden;border:1px solid #a78b4635;border-radius:11px;background:#080d15}.radar-panel-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;min-width:0;padding:8px 10px;border-bottom:1px solid #ffffff10}.radar-panel-heading h2{font-size:12px;font-weight:700;color:#ead7a4}.radar-panel-heading p,.radar-panel-heading>span{font-size:9px;color:#aab3c0;overflow-wrap:anywhere}.radar-panel-heading>span{flex-shrink:0;color:#d5bd79}.panel-source-note{display:flex;flex-wrap:wrap;gap:3px 10px;padding:6px 9px;color:#acb6c3;font-size:9px;overflow-wrap:anywhere}.radar-leaders{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;min-width:0;padding:0 7px 7px}.radar-leader{min-width:0;overflow:hidden;text-align:left;padding:0;border:1px solid #a78b4645;border-radius:10px;background:linear-gradient(140deg,#262116,#090e16 80%)}.radar-leader-button{display:block;width:100%;min-width:0;height:100%;text-align:left;padding:8px;color:white}.radar-leader-heading,.radar-leader-identity{display:flex;align-items:center;min-width:0;gap:6px}.radar-leader-heading{justify-content:space-between}.radar-leader-identity strong{min-width:0;overflow-wrap:anywhere;color:#fff;font-size:14px}.radar-leader-identity span:not(.slot-number){font-size:9px;color:#c6c9cf}.slot-number{flex-shrink:0;color:#d8bd75;font-size:10px}.radar-score-line{display:flex;align-items:flex-start;gap:6px;min-width:0;margin-top:8px}.radar-score-line b{flex-shrink:0;color:#ead7a4;font-family:monospace;font-size:16px}.radar-score-line span{min-width:0;color:#aeb6c0;font-size:9px;overflow-wrap:anywhere}.radar-source-route,.radar-slot-warning,.radar-slot-note,.radar-slot-reason,.radar-leader time{display:block;margin-top:5px;min-width:0;color:#aab3c0;font-size:9px;line-height:1.35;overflow-wrap:anywhere;word-break:break-word}.radar-slot-warning{color:#fda4af}.radar-slot-note{color:#d3c58f}.radar-slot-reason{max-height:3.9em;overflow:hidden}.radar-leader time{color:#7f8998}.radar-leader-placeholder{min-height:134px;border-style:dashed;background:#ffffff03}.radar-leader-placeholder strong{display:block;color:#c8cbd1;font-size:11px;overflow-wrap:anywhere}.radar-leader-placeholder p{margin-top:5px;color:#828d9b;font-size:9px;overflow-wrap:anywhere}
      .radar-ranking{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;border:1px solid #ffffff16;border-radius:10px;background:#080d15;overflow:hidden}.radar-inventory-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;min-width:0;padding:6px 8px}.radar-inventory-heading h2{font-size:11px;font-weight:600;color:#fff;overflow-wrap:anywhere}.radar-inventory-heading span,.radar-inventory-note{font-size:9px;color:#aab3c0;overflow-wrap:anywhere}.radar-inventory-note{padding:0 8px 5px;color:#dbc787}.radar-columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;flex:1;min-width:0;min-height:0;padding:0 5px 5px}.radar-column{display:flex;flex-direction:column;min-width:0;min-height:0;border:1px solid #ffffff0d;border-radius:6px;overflow:hidden}.rank-column-heading,.rank-cell{display:grid;grid-template-columns:22px minmax(54px,.72fr) minmax(132px,1.65fr) minmax(56px,.72fr);align-items:center;gap:4px;padding:3px 5px}.rank-column-heading{white-space:nowrap;min-height:23px;flex-shrink:0;color:#ffffff75;background:#ffffff05;font-size:8px}.rank-column-body{display:grid;grid-template-rows:repeat(15,minmax(32px,auto));min-width:0;min-height:0;overflow-y:auto}.rank-cell{min-width:0;min-height:32px;width:100%;text-align:left;border-bottom:1px solid #ffffff0b;border-left:2px solid #a78b4640;font-size:clamp(9px,1.2vh,11px);line-height:1.15;overflow:hidden;background:#ffffff01}.rank-cell:hover{background:#d6b66212}.rank-cell:focus-visible{outline:1px solid #d6b662;outline-offset:-2px}.rank-blocked{border-left-color:#fb718560}.rank-unknown{border-left-color:#ffffff30;opacity:.72}.rank-score-zero{border-left-color:#ffffff18}.rank-symbol{overflow-wrap:anywhere}.rank-order-block{max-width:72px}.rank-score-cell small{font-size:8px}.rank-strategy-badges{display:flex;min-width:0;flex-wrap:wrap;gap:2px}.rank-strategy-badge{display:inline-flex;min-width:0;align-items:center;gap:3px;border:1px solid #ffffff20;border-radius:5px;padding:2px 4px;font-size:8px;line-height:1.05;white-space:nowrap}.rank-strategy-badge b{max-width:86px;overflow:hidden;text-overflow:ellipsis;font-weight:700}.rank-strategy-badge em{font-style:normal;font-weight:800}.rank-strategy-badge small{font-size:6px;opacity:.7}.rank-strategy-long{border-color:#34d39955;background:#10b98112;color:#86efac}.rank-strategy-short{border-color:#fb718555;background:#f43f5e12;color:#fda4af}.rank-strategy-wait{border-color:#ffffff22;background:#ffffff08;color:#cbd5e1}.rank-strategy-stale{opacity:.72}.rank-strategy-empty{font-size:8px;color:#ffffff50}.rank-strategy-badges-compact{margin-top:1px}.radar-leader-strategies{margin-top:6px;min-width:0}.radar-tail{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;flex-shrink:0;padding:0 5px 5px}.radar-tail .rank-cell{min-height:34px;border:1px solid #ffffff12;border-radius:5px;font-size:9px}
      .rank-dialog{width:min(720px,calc(100vw - 24px));max-height:85dvh;padding:0;border:1px solid #a78b4660;border-radius:18px;background:#080d15;color:white}.rank-dialog[open]{display:flex;flex-direction:column}.rank-dialog::backdrop{background:#000a;backdrop-filter:blur(3px)}
      @keyframes radar-gold-flash{0%{background-color:rgba(244,211,125,.04)}25%{background-color:rgba(255,223,133,.30);box-shadow:inset 0 0 35px rgba(255,216,116,.15)}100%{background-color:transparent}}.rank-flash{animation:radar-gold-flash 1.1s ease-out}@media(prefers-reduced-motion:reduce){.rank-flash{animation:none;outline:1px solid #f2d27e88}}
      @media(min-width:768px) and (max-width:1000px){.radar-columns{grid-template-columns:repeat(2,minmax(0,1fr))}.radar-tail{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:767px){.compact-radar{height:auto;min-height:100%;overflow-x:hidden}.radar-heading{align-items:flex-start}.radar-heading h1{white-space:normal;font-size:12px}.radar-panel-list{grid-template-columns:minmax(0,1fr)}.radar-leaders{grid-template-columns:minmax(0,1fr)}.radar-leader-placeholder{min-height:78px}.radar-feedback{align-items:flex-start}.feedback-notice{flex-basis:100%}.radar-filters{flex-wrap:wrap}.radar-filters input{flex-basis:100%}.radar-filters select{flex:1}.radar-columns{grid-template-columns:minmax(0,1fr)}.rank-column-body{display:block;max-height:none;overflow:visible}.rank-cell{min-height:48px;grid-template-columns:28px minmax(54px,.75fr) minmax(132px,1.65fr) minmax(72px,.8fr);font-size:10px}.rank-column-heading{grid-template-columns:28px minmax(54px,.75fr) minmax(132px,1.65fr) minmax(72px,.8fr)}.rank-score-cell{overflow-wrap:anywhere}.radar-tail{grid-template-columns:minmax(0,1fr)}.radar-ranking{flex:none;overflow:visible}.radar-inventory-heading{flex-wrap:wrap}.rank-dialog{max-height:80dvh}}
    `}</style>
  </div>;
}
