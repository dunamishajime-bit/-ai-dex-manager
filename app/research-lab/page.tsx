import {
  Activity,
  BarChart3,
  Bot,
  CheckCircle2,
  RefreshCw,
  Shield,
  Target,
  Trophy,
  Users,
  Waves,
} from "lucide-react";

import ChampionDeepResearchPanel from "@/components/research-lab/ChampionDeepResearchPanel";
import LatestDiscussionSummary from "@/components/research-lab/LatestDiscussionSummary";
import LiveResearchDashboard from "@/components/research-lab/LiveResearchDashboard";
import ResearchLabSubnav from "@/components/research-lab/ResearchLabSubnav";
import { DEFAULT_PERP_RESEARCH_CONFIG } from "@/lib/research-lab/perp/config";
import { CRITICS, RESEARCHERS } from "@/lib/research-lab/roles";

function StatCard({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-[22px] border border-gold-400/16 bg-white/[0.035] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-100/70">{label}</span>
        <Icon className="h-4 w-4 text-gold-100" />
      </div>
      <div className="mt-3 text-3xl font-black text-white">{value}</div>
      <p className="mt-2 text-[11px] leading-5 text-white/68">{note}</p>
    </div>
  );
}

const PIPELINE = [
  "OOS・Stress・安定性の上位3 Championを選定",
  "3つの親ロジックを同条件で再評価",
  "失敗原因をChampionごとに分解",
  "各Championへ最大2つの改善仮説を提案",
  "1実験につき1パラメータだけ変更",
  "全親子をOOS・Walk-forward・Cost Stress検証",
  "OOS・Stress・DD・取引数を親子比較",
  "改善した子だけ継承し、悪化した子は破棄",
];

export default function ResearchLabPage() {
  const config = DEFAULT_PERP_RESEARCH_CONFIG;
  const thresholds = config.thresholds;
  const cyclesPerDay = 6;
  const champions = 3;
  const experimentsPerChampion = 2;
  const experimentsPerCycle = champions * experimentsPerChampion;
  const fullValidationsPerCycle = champions + experimentsPerCycle;

  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] text-white shadow-[0_0_30px_rgba(253,224,71,0.06)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.11),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.07),transparent_30%)]" />
      <div className="relative z-10 space-y-4 p-3 md:p-5">
        <section className="rounded-[28px] border border-gold-400/18 bg-[linear-gradient(180deg,rgba(17,18,20,0.92),rgba(6,8,12,0.96))] p-5 md:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/75">
                <Activity className="h-4 w-4" />
                DisdexManager V2
              </div>
              <h1 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">AI Hedge Fund Research Lab</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/76">
                平均月利30%超を研究目標に、上位ロジックを何度も深掘りして育てます。大量の一発提案を繰り返す方式は停止し、
                OOS・Stress・安定性の3 Championについて原因分析、単一変更、親子比較、改善継承を繰り返します。
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-xs font-bold text-violet-100">
              <Bot className="h-4 w-4" />
              Champion Deep Loop
            </div>
          </div>
        </section>

        <ResearchLabSubnav />
        <LiveResearchDashboard />
        <ChampionDeepResearchPanel />
        <LatestDiscussionSummary />

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Monthly Target" value={`${thresholds.targetAverageMonthlyReturnPct}%+`} note="完全未使用OOSで平均月利を判定" icon={Target} />
          <StatCard label="Deep Cycles" value={`${cyclesPerDay}/日`} note="4時間ごとに原因分析と親子比較" icon={RefreshCw} />
          <StatCard label="Daily Experiments" value={`${cyclesPerDay * experimentsPerCycle}`} note={`1 cycle ${experimentsPerCycle}件の単一変更`} icon={Waves} />
          <StatCard label="Full Validation" value={`${cyclesPerDay * fullValidationsPerCycle}`} note="親も含め全てOOS・WF・Stress検証" icon={Users} />
          <StatCard label="AI Critics" value={`${CRITICS.length}`} note={`${RESEARCHERS.length}研究役を過学習・Risk・Execution面から反証`} icon={Shield} />
        </section>

        <section className="rounded-[24px] border border-violet-400/20 bg-violet-500/[0.055] p-4 md:p-5">
          <div className="flex items-start gap-3">
            <Bot className="mt-0.5 h-5 w-5 shrink-0 text-violet-200" />
            <div>
              <h2 className="font-bold text-violet-50">4時間ごとのChampion深掘り研究</h2>
              <p className="mt-2 text-sm leading-6 text-violet-50/76">
                1Cycleは3つの親ロジックを再評価し、各Championへ最大2件、合計6件の単一変更だけを試します。
                親3件と子6件の合計9件を完全OOS・Walk-forward・Cost Stressまで通し、親より改善した子だけを次Cycleへ継承します。
                目標未達でも改善方向が再現できれば育成を続け、Trainだけ上がった子やDD・Stressが悪化した子は破棄します。
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-rose-400/20 bg-rose-500/[0.055] p-4 md:p-5">
          <div className="flex items-start gap-3">
            <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-rose-200" />
            <div>
              <h2 className="font-bold text-rose-50">大量探索を主役から外した理由</h2>
              <p className="mt-2 text-sm leading-6 text-rose-50/76">
                初回提案を大量に作っても、高月利とOOS再現性を同時に満たす可能性は低いためです。新規Seed探索はChampionが存在しない場合の補助に限定し、
                通常運用では上位3本の失敗原因、Entry・Exit・コスト・レジーム・方向偏りを分解して改善履歴を積み上げます。
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[24px] border border-gold-400/16 bg-white/[0.035] p-4 md:p-5">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-gold-100" />
              <h2 className="font-bold">Champion Deep Research Pipeline</h2>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {PIPELINE.map((item, index) => (
                <div key={item} className="flex items-center gap-3 rounded-[18px] border border-white/8 bg-black/20 px-4 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gold-400/24 bg-gold-400/10 text-xs font-black text-gold-50">
                    {index + 1}
                  </div>
                  <span className="text-sm font-semibold text-white/86">{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-gold-400/16 bg-white/[0.035] p-4 md:p-5">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-gold-100" />
              <h2 className="font-bold">CIO最終候補基準</h2>
            </div>
            <div className="mt-4 space-y-2 text-sm text-white/78">
              <div className="flex justify-between rounded-xl border border-white/8 px-3 py-2"><span>OOS平均月利</span><b>{thresholds.finalMinOosAverageMonthlyReturnPct}%以上</b></div>
              <div className="flex justify-between rounded-xl border border-white/8 px-3 py-2"><span>OOS MaxDD</span><b>{thresholds.finalMaxOosDrawdownPct}%以下</b></div>
              <div className="flex justify-between rounded-xl border border-white/8 px-3 py-2"><span>Long / Short</span><b>両方向必須</b></div>
              <div className="flex justify-between rounded-xl border border-white/8 px-3 py-2"><span>Liquidation</span><b>0件</b></div>
              <div className="flex justify-between rounded-xl border border-white/8 px-3 py-2"><span>Walk-forward</span><b>{thresholds.finalMinWalkForwardPassRatePct}%以上</b></div>
              <div className="flex justify-between rounded-xl border border-white/8 px-3 py-2"><span>Extreme Stress月利</span><b>{thresholds.finalMinStressAverageMonthlyReturnPct}%以上</b></div>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-sky-400/18 bg-sky-500/[0.055] p-4 md:p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-sky-200" />
            <div>
              <h2 className="font-bold text-sky-50">収益目標と実売買を分離</h2>
              <p className="mt-2 text-sm leading-6 text-sky-50/75">
                月利30%は研究目標であり保証値ではありません。自動化範囲はResearchとForward Paper候補までです。
                AsterDEX、実売買、ウォレット、注文実行、API Keyには接続しません。
              </p>
              <code className="mt-3 block overflow-x-auto rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/80">
                npm run research:perp:autonomous
              </code>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
