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

import LiveResearchDashboard from "@/components/research-lab/LiveResearchDashboard";
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
  "前回Elite・State読込",
  "過去検証済みロジックを除外",
  "Long / Short戦略生成",
  "Train期間で進化探索",
  "Validation・完全未使用OOS",
  "Walk-forward・Cost Stress",
  "失敗理由の自動分類・反省",
  "次世代Elite・研究計画を保存",
];

export default function ResearchLabPage() {
  const config = DEFAULT_PERP_RESEARCH_CONFIG;
  const thresholds = config.thresholds;
  const hourlyEvaluations = 5 * 5;
  const dailyEvaluations = 24 * hourlyEvaluations;

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
                平均月利30%超を研究目標に、USD-M FuturesのLong / Short戦略を完全自動で生成・検証・反省・進化させます。
                前回のEliteを次回へ引き継ぎ、過去に検証済みの同一ロジック、OOSで再現しない高収益値、清算を伴う戦略は採用しません。
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-4 py-2 text-xs font-bold text-emerald-100">
              <Bot className="h-4 w-4" />
              Hourly Autonomous
            </div>
          </div>
        </section>

        <LiveResearchDashboard />

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Monthly Target" value={`${thresholds.targetAverageMonthlyReturnPct}%+`} note="完全未使用OOSで平均月利を判定" icon={Target} />
          <StatCard label="Daily Research" value={`${dailyEvaluations}`} note={`毎時${hourlyEvaluations}件 × 24 cycle`} icon={RefreshCw} />
          <StatCard label="Directions" value="Long / Short" note="下落相場も独立した収益源として研究" icon={Waves} />
          <StatCard label="AI Researchers" value={`${RESEARCHERS.length}`} note="専門分野別に戦略を生成・変異" icon={Users} />
          <StatCard label="AI Critics" value={`${CRITICS.length}`} note="過学習・テールリスク・約定面を反証" icon={Shield} />
        </section>

        <section className="rounded-[24px] border border-emerald-400/20 bg-emerald-500/[0.055] p-4 md:p-5">
          <div className="flex items-start gap-3">
            <Bot className="mt-0.5 h-5 w-5 shrink-0 text-emerald-200" />
            <div>
              <h2 className="font-bold text-emerald-50">1時間ごとの完全自動研究</h2>
              <p className="mt-2 text-sm leading-6 text-emerald-50/76">
                毎時17分（JST）に自動起動し、各cycleで25件、1日最大600件の新規ロジックを評価します。
                小さなcycleごとにEliteと失敗理由を保存するため、以前の4回／日構成より改善内容を早く次世代へ反映できます。
                実行中のcycleは中断せず、同時書込みを禁止します。
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-rose-400/20 bg-rose-500/[0.055] p-4 md:p-5">
          <div className="flex items-start gap-3">
            <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-rose-200" />
            <div>
              <h2 className="font-bold text-rose-50">Phase 2 Spot研究の採用判断</h2>
              <p className="mt-2 text-sm leading-6 text-rose-50/76">
                2023年1月〜2026年7月の公式1時間足で50戦略を検証しました。最高Train平均月利は5.60%でしたが取引5回のみで、
                Validation平均月利-3.84%、OOS取引0回。取引数とのバランスが良い戦略もOOS平均月利-1.66%でした。
                最終候補は0件、実売買とForward Paperへの昇格はありません。
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[24px] border border-gold-400/16 bg-white/[0.035] p-4 md:p-5">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-gold-100" />
              <h2 className="font-bold">完全自動研究パイプライン</h2>
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
