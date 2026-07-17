import {
  Activity,
  Bot,
  CheckCircle2,
  FlaskConical,
  LockKeyhole,
  RefreshCw,
  Shield,
  Target,
  Trophy,
  Waves,
} from "lucide-react";

import LatestDiscussionSummary from "@/components/research-lab/LatestDiscussionSummary";
import ResearchLabSubnav from "@/components/research-lab/ResearchLabSubnav";
import { MAIN_STRATEGY_RESEARCH_POLICY } from "@/lib/research-lab/perp/main-strategy-research-policy";
import { MAIN_STRATEGY_RESEARCH_PROGRAM_ID } from "@/lib/research-lab/perp/main-strategy-research-program";
import { WIN80_ULTRA90_MAIN_STRATEGY } from "@/lib/win80-ultra90-main-strategy";

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
      <div className="mt-3 text-2xl font-black text-white">{value}</div>
      <p className="mt-2 text-[11px] leading-5 text-white/68">{note}</p>
    </div>
  );
}

const PIPELINE = [
  "現行メインWIN80_ULTRA90_TOP1_V1を唯一の固定親として読み込む",
  "Score80/90・Confidence・Trigger・RR・Volume・50%/70%を実変数として分解",
  "毎Cycleは1テーマに絞り、直接子ロジックを最大2件提案",
  "方向性が近い新ロジックはメインを変更せず独立IDで設計",
  "Overfit・Tail Risk・Execution Criticが反論",
  "再現リプレイがない案はREPLAY_REQUIREDのまま維持",
  "親子BT・凍結Holdout・Forward Paper後にだけ採否判断",
  "旧deep-c* Championはアーカイブし、主研究へ継承しない",
];

export default function ResearchLabPage() {
  const strategy = WIN80_ULTRA90_MAIN_STRATEGY;
  const reference = MAIN_STRATEGY_RESEARCH_POLICY.historicalReference;
  const cyclesPerDay = 6;

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
              <h1 className="mt-3 text-3xl font-black tracking-tight md:text-5xl">Win80 Direct Main Strategy Research</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/76">
                AI研究ラボは、汎用Perpetual Championの継続研究から、現在のメイン
                <b className="mx-1 text-gold-100">{strategy.id}</b>
                本体の深掘りへ切り替わりました。旧deep-c*を親にせず、実際のEntry閾値、Top-1、50%分割、70%Rotationを直接議論します。
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/10 px-4 py-2 text-xs font-bold text-sky-100">
              <Bot className="h-4 w-4" />
              {MAIN_STRATEGY_RESEARCH_PROGRAM_ID}
            </div>
          </div>
        </section>

        <ResearchLabSubnav />
        <LatestDiscussionSummary />

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Fixed Main" value={strategy.id} note="研究結果による自動置換なし" icon={LockKeyhole} />
          <StatCard label="Historical Compound" value={`${reference.compoundMonthlyPct.toFixed(2)}%`} note="同一期間調整値・未使用OOSではない" icon={Trophy} />
          <StatCard label="Historical Trades" value={`${reference.trades}`} note={`勝率 ${reference.winRatePct.toFixed(2)}% / PF ${reference.profitFactor.toFixed(2)}`} icon={Target} />
          <StatCard label="Research Cycles" value={`${cyclesPerDay}/日`} note="4時間ごとに現行メインを直接研究" icon={RefreshCw} />
          <StatCard label="Real Trading" value="DISABLED" note="研究・リプレイ・Forward Paperまで" icon={Shield} />
        </section>

        <section className="rounded-[24px] border border-sky-400/20 bg-sky-500/[0.055] p-4 md:p-5">
          <div className="flex items-start gap-3">
            <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-sky-200" />
            <div>
              <h2 className="font-bold text-sky-50">実際に研究するパラメータ</h2>
              <p className="mt-2 text-sm leading-7 text-sky-50/76">
                Win80はScore {strategy.win80.minScore}、Confidence {(strategy.win80.minConfidence * 100).toFixed(0)}%、Trigger {(strategy.win80.minTriggerProgress * 100).toFixed(0)}%、RR {strategy.win80.minRr.toFixed(2)}、Volume {strategy.win80.minVolumeRatio.toFixed(2)}。
                Ultra90はScore {strategy.ultra90.minScore}、Confidence {(strategy.ultra90.minConfidence * 100).toFixed(0)}%、Trigger {(strategy.ultra90.minTriggerProgress * 100).toFixed(0)}%、RR {strategy.ultra90.minRr.toFixed(2)}、Volume {strategy.ultra90.minVolumeRatio.toFixed(2)}です。
                さらに初回100%、含み益時50%分割、Ultra90時70%移動、最大2通貨を個別に研究します。
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[24px] border border-gold-400/16 bg-white/[0.035] p-4 md:p-5">
            <div className="flex items-center gap-2">
              <Waves className="h-4 w-4 text-gold-100" />
              <h2 className="font-bold">Direct Main Research Pipeline</h2>
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

          <div className="space-y-4">
            <div className="rounded-[24px] border border-emerald-400/18 bg-emerald-500/[0.055] p-4 md:p-5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-200" />
                <h2 className="font-bold text-emerald-50">採用判断</h2>
              </div>
              <p className="mt-3 text-sm leading-7 text-emerald-50/75">
                議論で良さそうに見えても、再現可能な親子リプレイ、凍結Holdout、コストStress、Forward Paperを通るまでメインへ反映しません。結果がない案は「提案」「REPLAY_REQUIRED」と表示します。
              </p>
            </div>

            <div className="rounded-[24px] border border-rose-400/18 bg-rose-500/[0.055] p-4 md:p-5">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-rose-200" />
                <h2 className="font-bold text-rose-50">旧Champion State</h2>
              </div>
              <p className="mt-3 text-sm leading-7 text-rose-50/75">
                Cycle 7〜12のdeep-c*研究は削除せずアーカイブしますが、現行メイン研究の親・成績・最新表示には使用しません。議論ページでは「旧ログも表示」を選んだ場合だけ確認できます。
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-[24px] border border-white/10 bg-white/[0.025] p-4 md:p-5">
          <div className="flex items-start gap-3">
            <Shield className="mt-0.5 h-5 w-5 shrink-0 text-white/55" />
            <div>
              <h2 className="font-bold text-white/85">Evidence制限</h2>
              <p className="mt-2 text-sm leading-7 text-white/60">
                現在保存されている月利16.81%は歴史参考値です。完全な取引ログと固定StrategyEngineInputリプレイがRepositoryで再現できるまでは、汎用Perpetual GenomeのOOS成績を代用しません。メイン戦略と実売買設定は変更していません。
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
