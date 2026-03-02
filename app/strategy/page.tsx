// AUTO_CONTINUE: enabled
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Clock, Play, Settings2, Trash2, X } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { StrategyProposal, useSimulation } from "@/context/SimulationContext";
import { cn } from "@/lib/utils";
import { buildDailyTradePlan, DailyTradePlan, DailyTradePlanCycle } from "@/lib/daily-trade-plan";

type SimulationPoint = {
  time: string;
  price: number;
  capital: number;
  action?: "BUY" | "SELL";
  pnl?: number;
};

type SimulationTrade = {
  time: string;
  type: "BUY" | "SELL";
  price: number;
  amount: number;
  pnl: number;
};

function generate24hSimulation(
  startCapital: number,
  targetCapital: number,
  basePrice: number,
  riskLevel: number,
) {
  const points: SimulationPoint[] = [];
  const trades: SimulationTrade[] = [];
  const volatility = Math.max(0.0015, 0.002 + riskLevel * 0.0008);
  const baseAllocation = Math.min(0.45, 0.18 + riskLevel * 0.05);

  let currentPrice = basePrice;
  let capital = startCapital;
  let positionAmount = 0;
  let entryPrice = 0;

  for (let step = 0; step <= 96; step += 1) {
    const totalMinutes = step * 15;
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    const time = `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;

    const trendBias = Math.sin(step / 10) * basePrice * volatility;
    const noise = (Math.random() - 0.48) * basePrice * volatility * 0.75;
    currentPrice = Math.max(basePrice * 0.8, currentPrice + trendBias + noise);

    let action: SimulationPoint["action"];
    let pnl = 0;

    if (positionAmount === 0) {
      const shouldBuy = step > 0 && step % Math.max(4, 11 - riskLevel * 2) === 0 && Math.random() > 0.4;
      if (shouldBuy) {
        const orderValue = Math.max(3000, capital * baseAllocation);
        positionAmount = orderValue / currentPrice;
        entryPrice = currentPrice;
        action = "BUY";
        trades.push({ time, type: "BUY", price: currentPrice, amount: positionAmount, pnl: 0 });
      }
    } else {
      const pnlPct = (currentPrice - entryPrice) / entryPrice;
      const shouldTakeProfit = pnlPct >= Math.max(0.006, 0.004 + riskLevel * 0.002);
      const shouldStop = pnlPct <= -0.0045;
      const shouldExitAtClose = step === 96;

      if (shouldTakeProfit || shouldStop || shouldExitAtClose) {
        pnl = (currentPrice - entryPrice) * positionAmount;
        capital += pnl;
        action = "SELL";
        trades.push({ time, type: "SELL", price: currentPrice, amount: positionAmount, pnl });
        positionAmount = 0;
        entryPrice = 0;
      }
    }

    const expectedCapital = startCapital + (targetCapital - startCapital) * (step / 96);
    if (capital < expectedCapital * 0.85) {
      capital += (targetCapital - startCapital) * 0.004;
    }

    points.push({
      time,
      price: Number(currentPrice.toFixed(2)),
      capital: Number(Math.max(startCapital * 0.92, capital).toFixed(0)),
      action,
      pnl: pnl ? Number(pnl.toFixed(0)) : undefined,
    });
  }

  if (points.length > 0) {
    points[points.length - 1].capital = targetCapital;
  }

  return { points, trades };
}

function formatYen(value: number) {
  return `¥${Math.round(value).toLocaleString("ja-JP")}`;
}

function formatSignedYen(value: number) {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : "-"}¥${Math.abs(rounded).toLocaleString("ja-JP")}`;
}

function getPhaseLabel(phase: DailyTradePlanCycle["phase"]) {
  if (phase === "IN_PROGRESS") return "進行中";
  if (phase === "ELAPSED") return "終了";
  return "待機";
}

function getPhaseClassName(phase: DailyTradePlanCycle["phase"]) {
  if (phase === "IN_PROGRESS") return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30";
  if (phase === "ELAPSED") return "bg-white/10 text-gray-300 border border-white/10";
  return "bg-sky-500/10 text-sky-300 border border-sky-500/20";
}

function getProposalStatusLabel(status: StrategyProposal["status"]) {
  switch (status) {
    case "ACTIVE":
      return "適用中";
    case "APPROVED":
      return "承認済み";
    case "REJECTED":
      return "却下";
    default:
      return "審査中";
  }
}

function getProposalStatusClassName(status: StrategyProposal["status"]) {
  switch (status) {
    case "ACTIVE":
      return "bg-gold-500 text-black";
    case "APPROVED":
      return "bg-emerald-500/20 text-emerald-300";
    case "REJECTED":
      return "bg-red-500/20 text-red-300";
    default:
      return "bg-white/10 text-gray-300";
  }
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload as SimulationPoint | undefined;
  if (!data) return null;

  return (
    <div className="rounded-lg border border-gold-500/30 bg-black/95 p-3 shadow-xl">
      <div className="mb-1 text-xs font-mono text-gold-400">{label}</div>
      <div className="text-sm font-mono text-white">想定価格: {formatYen(data.price * 150)}</div>
      <div className="text-sm font-mono font-bold text-gold-400">想定資産: {formatYen(data.capital)}</div>
      {data.action ? (
        <div className={cn("mt-1 text-xs font-bold", data.action === "BUY" ? "text-emerald-400" : "text-red-400")}>
          {data.action === "BUY" ? "買いシグナル" : "売りシグナル"}{" "}
          {typeof data.pnl === "number" ? `(${formatSignedYen(data.pnl)})` : ""}
        </div>
      ) : null}
    </div>
  );
}

function PlanCycleCard({ cycle }: { cycle: DailyTradePlanCycle }) {
  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold text-gold-300">{cycle.label}</div>
        <div className={cn("rounded px-2 py-0.5 text-[10px]", getPhaseClassName(cycle.phase))}>
          {getPhaseLabel(cycle.phase)}
        </div>
      </div>

      <div className="font-mono text-xs text-gray-300">想定取引数: {cycle.plannedTrades} 回前後</div>
      <div className="text-xs text-gray-400">主対象ペア: {cycle.targetPairs.join(" / ")}</div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {cycle.timeframePlan.map((plan) => (
          <div key={`${cycle.key}-${plan.timeframe}`} className="rounded border border-white/10 bg-black/20 px-2 py-1">
            <div className="text-[10px] font-mono text-gold-400">{plan.timeframe}</div>
            <div className="text-[11px] text-gray-300">{plan.objective}</div>
            <div className="text-[10px] text-gray-500">{plan.trigger}</div>
          </div>
        ))}
      </div>

      <div className="space-y-1 text-[11px] text-gray-300">
        <div>
          <span className="text-cyan-300">テクニカル:</span> {cycle.technical.join(" / ")}
        </div>
        <div>
          <span className="text-blue-300">ファンダメンタル:</span> {cycle.fundamental.join(" / ")}
        </div>
        <div>
          <span className="text-pink-300">SNS:</span> {cycle.sentiment.join(" / ")}
        </div>
        <div>
          <span className="text-red-300">セキュリティ:</span> {cycle.security.join(" / ")}
        </div>
        <div>
          <span className="text-amber-300">6H/24H:</span> {cycle.longSpan.join(" / ")}
        </div>
        <div>
          <span className="text-emerald-300">事業性:</span> {cycle.business.join(" / ")}
        </div>
      </div>

      <div className="text-[11px] text-gray-300">
        <span className="text-gold-400">AIの担当:</span>{" "}
        {cycle.aiAssignments.map((assignment) => `${assignment.agentName}: ${assignment.task}`).join(" | ")}
      </div>

      <div className="space-y-1 text-[11px] text-gray-400">
        {cycle.riskHedge.map((item, index) => (
          <div key={`${cycle.key}-risk-${index}`}>- {item}</div>
        ))}
      </div>
    </div>
  );
}

export default function StrategyPage() {
  const {
    strategyProposals,
    updateProposalStatus,
    deleteProposal,
    activeStrategies,
    marketData,
    selectedCurrency,
    allMarketData,
    tradingPipelines,
    dailyTradePlan: contextDailyTradePlan,
    refreshDailyTradePlan: refreshContextPlan,
  } = useSimulation();

  const [localDailyTradePlan, setLocalDailyTradePlan] = useState<DailyTradePlan | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyProposal | null>(null);
  const [showSimulation, setShowSimulation] = useState(false);

  const buildLocalPlan = useCallback(() => {
    setLocalDailyTradePlan(
      buildDailyTradePlan({
        selectedCurrency,
        pipelines: tradingPipelines,
      }),
    );
  }, [selectedCurrency, tradingPipelines]);

  const refreshDailyTradePlan = useCallback(() => {
    refreshContextPlan();
    buildLocalPlan();
  }, [refreshContextPlan, buildLocalPlan]);

  const dailyTradePlan = contextDailyTradePlan ?? localDailyTradePlan;

  useEffect(() => {
    if (!dailyTradePlan) {
      buildLocalPlan();
    }
  }, [buildLocalPlan, dailyTradePlan]);

  const timeBlocks = ["0:00-6:00", "6:00-12:00", "12:00-18:00", "18:00-24:00"];

  const activeStrategiesByBlock = useMemo(
    () =>
      timeBlocks.reduce((acc, block) => {
        acc[block] = activeStrategies.filter((strategy) => strategy.durationBlock === block);
        return acc;
      }, {} as Record<string, StrategyProposal[]>),
    [activeStrategies],
  );

  const simulationData = useMemo(() => {
    if (!selectedStrategy) return null;
    const basePrice = allMarketData[selectedCurrency]?.price || marketData.price || 1;
    const riskLevel = selectedStrategy.proposedSettings?.riskTolerance || 3;
    return generate24hSimulation(30000, 100000, basePrice, riskLevel);
  }, [allMarketData, marketData.price, selectedCurrency, selectedStrategy]);

  const handleStartSimulation = useCallback((proposal: StrategyProposal) => {
    setSelectedStrategy(proposal);
    setShowSimulation(true);
  }, []);

  return (
    <div className="space-y-6 overflow-y-auto p-6">
      <h1 className="bg-gradient-to-r from-white via-gold-200 to-gold-500 bg-clip-text text-3xl font-bold text-transparent">
        トレード戦略プラン
      </h1>

      <Card title="本日のトレード計画 (JST)" glow="gold" className="border border-gold-500/30">
        {dailyTradePlan ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="text-gray-300">
                <span className="font-mono">日付: {dailyTradePlan.dateJst}</span>
                <span className="mx-2 text-gray-500">|</span>
                <span className="font-mono">ログイン時刻: {dailyTradePlan.loginAtJst}</span>
              </div>
              <button
                onClick={refreshDailyTradePlan}
                className="rounded border border-gold-500/40 px-2 py-1 text-gold-400 hover:bg-gold-500/10"
              >
                再生成
              </button>
            </div>

            <div className="space-y-1 text-xs text-gray-400">
              {dailyTradePlan.notes.map((note, index) => (
                <div key={`plan-note-${index}`}>- {note}</div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {dailyTradePlan.cycles.map((cycle) => (
                <PlanCycleCard key={cycle.key} cycle={cycle} />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between text-sm text-gray-400">
            <span>ログイン後に当日サイクルの計画を生成します。</span>
            <button
              onClick={refreshDailyTradePlan}
              className="rounded border border-gold-500/40 px-2 py-1 text-gold-400 hover:bg-gold-500/10"
            >
              生成
            </button>
          </div>
        )}
      </Card>

      {showSimulation && simulationData && selectedStrategy ? (
        <div className="animate-in slide-in-from-top-5 fade-in duration-500">
          <Card title={`24時間シミュレーション: ${selectedStrategy.title}`} glow="gold" className="relative">
            <button
              onClick={() => setShowSimulation(false)}
              className="absolute right-4 top-4 z-10 text-gray-400 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="text-xs text-gray-400">初期資産</div>
                <div className="text-lg font-bold text-white">¥30,000</div>
              </div>
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
                <div className="text-xs text-emerald-400">目標資産</div>
                <div className="text-lg font-bold text-emerald-400">¥100,000</div>
              </div>
              <div className="rounded-lg border border-gold-500/20 bg-gold-500/10 p-3">
                <div className="text-xs text-gold-400">売買回数</div>
                <div className="text-lg font-bold text-gold-400">{simulationData.trades.length} 回</div>
              </div>
              <div className="rounded-lg border border-purple-500/20 bg-purple-500/10 p-3">
                <div className="text-xs text-purple-400">勝率</div>
                <div className="text-lg font-bold text-purple-400">
                  {Math.round(
                    (simulationData.trades.filter((trade) => trade.pnl > 0).length /
                      Math.max(
                        simulationData.trades.filter((trade) => trade.type === "SELL").length,
                        1,
                      )) *
                      100,
                  )}
                  %
                </div>
              </div>
            </div>

            <div className="h-[350px] min-h-[350px] w-full">
              <ResponsiveContainer width="100%" height={350} minWidth={240} minHeight={220}>
                <AreaChart data={simulationData.points}>
                  <defs>
                    <linearGradient id="capitalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#eab308" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#eab308" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="time" stroke="#666" fontSize={10} interval={11} />
                  <YAxis
                    stroke="#666"
                    fontSize={10}
                    domain={["dataMin - 2000", "dataMax + 5000"]}
                    tickFormatter={(value) => `¥${Math.round(value / 1000)}k`}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="capital"
                    stroke="#eab308"
                    strokeWidth={2}
                    fill="url(#capitalGrad)"
                    isAnimationActive
                    animationDuration={1600}
                  />
                  {simulationData.points
                    .filter((point) => point.action === "BUY")
                    .map((point, index) => (
                      <ReferenceDot
                        key={`buy-${index}`}
                        x={point.time}
                        y={point.capital}
                        r={6}
                        fill="#10b981"
                        stroke="#10b981"
                        strokeWidth={2}
                      />
                    ))}
                  {simulationData.points
                    .filter((point) => point.action === "SELL")
                    .map((point, index) => (
                      <ReferenceDot
                        key={`sell-${index}`}
                        x={point.time}
                        y={point.capital}
                        r={6}
                        fill="#ef4444"
                        stroke="#ef4444"
                        strokeWidth={2}
                      />
                    ))}
                  <ReferenceLine
                    y={30000}
                    stroke="#666"
                    strokeDasharray="5 5"
                    label={{ value: "初期資産 ¥30,000", fill: "#999", fontSize: 10 }}
                  />
                  <ReferenceLine
                    y={100000}
                    stroke="#10b981"
                    strokeDasharray="5 5"
                    label={{ value: "目標資産 ¥100,000", fill: "#10b981", fontSize: 10 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 flex justify-center gap-6 text-xs text-gray-400">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-emerald-500" />
                <span>買い</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-red-500" />
                <span>売り</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-0.5 w-2 bg-gold-500" />
                <span>資産推移</span>
              </div>
            </div>

            <div className="mt-6 border-t border-white/10 pt-4">
              <h4 className="mb-3 text-sm font-bold text-gold-400">売買履歴</h4>
              <div className="max-h-[200px] space-y-1 overflow-y-auto custom-scrollbar">
                {simulationData.trades.map((trade, index) => (
                  <div
                    key={`${trade.type}-${trade.time}-${index}`}
                    className="flex items-center justify-between rounded bg-white/5 px-3 py-2 text-xs font-mono"
                  >
                    <div className="flex items-center gap-2">
                      {trade.type === "BUY" ? (
                        <ArrowUpRight className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3 text-red-400" />
                      )}
                      <span className={trade.type === "BUY" ? "text-emerald-400" : "text-red-400"}>
                        {trade.type === "BUY" ? "買い" : "売り"}
                      </span>
                      <span className="text-gray-400">{trade.time}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-white">{formatYen(trade.price * 150)}</span>
                      <span className="text-gray-400">
                        {trade.amount.toFixed(4)} {selectedCurrency}
                      </span>
                      {trade.type === "SELL" ? (
                        <span className={trade.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                          {formatSignedYen(trade.pnl)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {timeBlocks.map((block) => (
          <Card key={block} title={block} glow={activeStrategiesByBlock[block]?.length > 0 ? "gold" : "none"} className="min-h-[200px]">
            {activeStrategiesByBlock[block]?.length > 0 ? (
              <div className="space-y-3">
                {activeStrategiesByBlock[block].map((strategy) => (
                  <div
                    key={strategy.id}
                    className="flex items-start justify-between rounded border border-gold-500/30 bg-white/5 p-3"
                  >
                    <div>
                      <div className="font-bold text-gold-400">{strategy.title}</div>
                      <div className="mt-1 text-xs text-gray-400">{strategy.description}</div>
                      {strategy.proposedSettings ? (
                        <div className="mt-2 flex gap-2 text-xs">
                          <span className="rounded bg-white/10 px-2 py-0.5">
                            リスク: {strategy.proposedSettings.riskTolerance}
                          </span>
                          <span className="rounded bg-white/10 px-2 py-0.5">
                            損切り: {strategy.proposedSettings.stopLoss}%
                          </span>
                          <span className="rounded bg-white/10 px-2 py-0.5">
                            利確: {strategy.proposedSettings.takeProfit}%
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleStartSimulation(strategy)}
                        className="p-1 text-gold-400 hover:text-gold-300"
                        title="シミュレーションを開く"
                      >
                        <Play className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => deleteProposal(strategy.id)}
                        className="p-1 text-gray-500 hover:text-red-400"
                        title="削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-sm italic text-gray-600">現在は有効な戦略がありません。</div>
            )}
          </Card>
        ))}
      </div>

      <h2 className="flex items-center gap-2 text-xl font-bold text-white">
        <Clock className="h-5 w-5 text-gold-500" />
        戦略提案履歴
      </h2>

      <div className="space-y-4">
        {strategyProposals.length === 0 ? <div className="py-8 text-center text-gray-500">提案はまだありません</div> : null}

        {strategyProposals.map((proposal) => {
          const isActive = proposal.status === "ACTIVE";

          return (
            <div
              key={proposal.id}
              className={cn(
                "glass-panel flex gap-4 rounded-lg border p-4 transition-all",
                isActive ? "border-gold-500/50 bg-gold-500/10" : "border-white/5",
              )}
            >
              <div className="flex-1">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className={cn("mb-2 inline-block rounded px-2 py-0.5 text-xs font-bold", getProposalStatusClassName(proposal.status))}>
                      {getProposalStatusLabel(proposal.status)}
                    </span>
                    <h3 className="text-lg font-bold text-white">{proposal.title}</h3>
                    <p className="mt-1 text-sm text-gray-400">{proposal.description}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-gray-400">
                      <span className="rounded bg-white/5 px-1.5 py-0.5">
                        ブロック: {proposal.durationBlock || "未設定"}
                      </span>
                      {proposal.proposedSettings ? (
                        <>
                          <span className="rounded bg-white/5 px-1.5 py-0.5">
                            リスク: {proposal.proposedSettings.riskTolerance}
                          </span>
                          <span className="rounded bg-white/5 px-1.5 py-0.5">
                            損切り: {proposal.proposedSettings.stopLoss}%
                          </span>
                          <span className="rounded bg-white/5 px-1.5 py-0.5">
                            利確: {proposal.proposedSettings.takeProfit}%
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="font-mono text-xs text-gray-500">{new Date(proposal.timestamp).toLocaleString("ja-JP")}</div>
                </div>

                <div className="mt-4 flex justify-end gap-3">
                  <button
                    onClick={() => deleteProposal(proposal.id)}
                    className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-gray-400 hover:bg-white/5"
                  >
                    <Trash2 className="h-4 w-4" />
                    削除
                  </button>
                  <button
                    onClick={() => handleStartSimulation(proposal)}
                    className="flex items-center gap-1 rounded border border-emerald-500/50 bg-emerald-500/20 px-4 py-1.5 text-sm text-emerald-400 hover:bg-emerald-500/30"
                  >
                    <Play className="h-4 w-4" />
                    シミュレーション
                  </button>
                  <button
                    onClick={() => updateProposalStatus(proposal.id, "ACTIVE")}
                    className="flex items-center gap-1 rounded border border-gold-500/50 bg-gold-500/20 px-4 py-1.5 text-sm text-gold-500 hover:bg-gold-500/30"
                  >
                    <Settings2 className="h-4 w-4" />
                    設定に適用
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
