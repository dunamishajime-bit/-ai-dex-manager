import { getSamplePolymarketBacktest } from "@/lib/goldcat/polymarket";

function MetricCard({ title, value, text }: { title: string; value: string; text?: string }) {
  return (
    <div className="rounded-2xl border border-gold-400/15 bg-black/25 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold-100/70">{title}</div>
      <div className="mt-1 text-xl font-black text-white">{value}</div>
      {text ? <div className="mt-1 text-[11px] leading-5 text-white/65">{text}</div> : null}
    </div>
  );
}

function fmtPct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function PolymarketBacktestPanel() {
  const summary = getSamplePolymarketBacktest();
  const topScores = [...summary.scores].sort((a, b) => b.finalScore - a.finalScore).slice(0, 6);

  return (
    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.32em] text-gold-100/76">
            PolyMarket Simulated Backtest
          </div>
          <h2 className="mt-2 text-2xl font-black text-white">Auto Intelligence Router v1</h2>
          <p className="mt-2 max-w-3xl text-[12px] leading-6 text-white/72">
            現行ロジックは残したまま、PolyMarket市場をJSON snapshotで評価する新規ロジックです。
            ルールベースで95%以上を処理し、判断が難しい市場だけAI Escalation対象にします。
          </p>
        </div>
        <div className="rounded-full border border-gold-400/20 px-3 py-1 text-[11px] font-bold text-gold-50">
          {summary.snapshotPeriod}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricCard title="Markets" value={`${summary.totalMarkets}`} text="評価対象市場" />
        <MetricCard title="Trades" value={`${summary.totalTrades}`} text="想定Entry数" />
        <MetricCard title="Win Rate" value={`${summary.winRate.toFixed(1)}%`} text="想定勝率" />
        <MetricCard title="ROI" value={fmtPct(summary.roi)} text={`PnL $${summary.totalPnL.toFixed(2)}`} />
        <MetricCard title="Max DD" value={`$${summary.maxDrawdown.toFixed(2)}`} text="想定最大DD" />
        <MetricCard title="AI Usage" value={`${summary.aiUsagePct.toFixed(1)}%`} text={`${summary.aiEscalationCount} escalations`} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <MetricCard title="Entry" value={`${summary.entryCount}`} />
        <MetricCard title="Watch" value={`${summary.watchCount}`} />
        <MetricCard title="Reject" value={`${summary.rejectCount}`} />
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-gold-400/15">
        <div className="grid grid-cols-[1.4fr_0.55fr_0.55fr_0.55fr_0.7fr_0.7fr] gap-2 border-b border-gold-400/15 bg-gold-400/8 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-gold-100/80">
          <div>Market</div>
          <div>Side</div>
          <div>Edge</div>
          <div>ER</div>
          <div>Score</div>
          <div>Decision</div>
        </div>
        {topScores.map((score) => (
          <div
            key={score.market.marketId}
            className="grid grid-cols-[1.4fr_0.55fr_0.55fr_0.55fr_0.7fr_0.7fr] gap-2 border-b border-white/8 px-3 py-2 text-[11px] text-white/78 last:border-b-0"
          >
            <div>
              <div className="font-semibold text-white">{score.market.title}</div>
              <div className="mt-1 text-white/50">{score.market.category}</div>
            </div>
            <div>{score.market.recommendedSide}</div>
            <div>{fmtPct(score.market.edge)}</div>
            <div>{fmtPct(score.market.expectedReturn)}</div>
            <div className="font-black text-gold-50">{score.finalScore.toFixed(1)}</div>
            <div>
              <span className="rounded-full border border-gold-400/20 px-2 py-1 text-[10px] font-bold text-gold-50">
                {score.decision}
              </span>
              {score.aiEscalated ? <div className="mt-1 text-[10px] text-sky-200">AI review</div> : null}
              {score.rejectReason ? <div className="mt-1 text-[10px] text-red-200">{score.rejectReason}</div> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-gold-400/15">
        <div className="border-b border-gold-400/15 bg-gold-400/8 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-gold-100/80">
          Simulated Trade Log
        </div>
        {summary.trades.length ? (
          summary.trades.map((trade) => (
            <div key={trade.tradeId} className="grid gap-2 border-b border-white/8 px-3 py-2 text-[11px] text-white/76 md:grid-cols-[1.4fr_0.5fr_0.5fr_0.5fr_0.6fr] last:border-b-0">
              <div>
                <div className="font-semibold text-white">{trade.title}</div>
                <div className="mt-1 text-white/50">{trade.entryReason}</div>
              </div>
              <div>{trade.side}</div>
              <div>{trade.entryPrice.toFixed(2)} → {trade.exitPrice.toFixed(2)}</div>
              <div className={trade.pnlUsd >= 0 ? "text-profit" : "text-loss"}>${trade.pnlUsd.toFixed(2)}</div>
              <div>{trade.exitReason}</div>
            </div>
          ))
        ) : (
          <div className="px-3 py-4 text-[12px] text-white/60">Entry対象の想定トレードはありません。</div>
        )}
      </div>
    </section>
  );
}
