"use client";

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Coins,
  Gauge,
  Settings,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

function SummaryCard({
  title,
  value,
  text,
  tone = "default",
}: {
  title: string;
  value: string;
  text: string;
  tone?: "default" | "profit" | "loss";
}) {
  return (
    <div className="panel-gold rounded-[24px] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.26em] text-gold-100/72">{title}</div>
      <div
        className={`mt-2 text-[1.45rem] font-black ${
          tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : "text-white"
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-5 text-white/78">{text}</div>
    </div>
  );
}

function StrategyCard({
  eyebrow,
  title,
  status,
  text,
  chips,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  status: string;
  text: string;
  chips: string[];
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="panel-gold rounded-[26px] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.26em] text-gold-100/72">
            <Icon className="h-3.5 w-3.5" />
            {eyebrow}
          </div>
          <h2 className="mt-2 text-lg font-black text-white">{title}</h2>
        </div>
        <span className="rounded-full border border-profit/30 bg-profit/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-profit">
          {status}
        </span>
      </div>
      <p className="mt-3 text-[12px] leading-6 text-white/80">{text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span
            key={chip}
            className="rounded-full border border-gold-400/18 bg-gold-400/[0.07] px-2.5 py-1 text-[10px] font-semibold text-gold-50"
          >
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}

function QuickLink({
  href,
  title,
  text,
  icon: Icon,
}: {
  href: string;
  title: string;
  text: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link
      href={href}
      className="group rounded-[22px] border border-gold-400/16 bg-[linear-gradient(180deg,rgba(8,10,15,0.34),rgba(4,6,10,0.64))] px-4 py-4 transition hover:border-gold-300/36"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Icon className="h-4 w-4 text-gold-100" />
          {title}
        </div>
        <ArrowRight className="h-4 w-4 text-gold-100/70 transition group-hover:translate-x-0.5" />
      </div>
      <p className="mt-2 text-[11px] leading-5 text-white/76">{text}</p>
    </Link>
  );
}

export default function HomePage() {
  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] text-white shadow-[0_0_30px_rgba(253,224,71,0.06)]">
      <div className="absolute inset-0 bg-[url('/backgrounds/login_bg.png')] bg-cover bg-center opacity-[0.22] mix-blend-screen" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.12),transparent_22%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.05),transparent_28%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,5,10,0.12),rgba(3,5,10,0.68))]" />

      <div className="relative z-10 space-y-3 p-3 md:p-4">
        <section className="grid gap-3 xl:grid-cols-[1.18fr_0.82fr]">
          <div className="panel-gold rounded-[30px] p-4 md:p-5">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.32em] text-gold-100/76">
              <ShieldCheck className="h-3.5 w-3.5" />
              DisDex Production System
            </div>
            <h1 className="gold-heading mt-3 text-[2.1rem] font-black tracking-tight md:text-[3rem]">
              V96・PENGU V2・V52を統合した現在の本番構成。
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-white/86 md:text-[15px]">
              Aster Perpetualを実行基盤に、Crypto V96、独立PENGU Long / Short、米国株V52を同一のMargin Guardと
              Portfolio Gross制御の下で運用します。PENGU Legacy V1は停止し、現在は
              <span className="font-bold text-gold-100"> PENGU_DUAL_LS_V2_FINAL </span>
              が唯一のPENGU注文オーナーです。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-profit/30 bg-profit/10 px-3 py-1.5 text-[11px] font-semibold text-profit">
                Aster 5x Cross
              </span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/[0.08] px-3 py-1.5 text-[11px] font-semibold text-gold-50">
                Combined Gross 2.5
              </span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/[0.08] px-3 py-1.5 text-[11px] font-semibold text-gold-50">
                Fail Closed
              </span>
              <span className="rounded-full border border-gold-400/20 bg-gold-400/[0.08] px-3 py-1.5 text-[11px] font-semibold text-gold-50">
                Margin Guard
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <SummaryCard
              title="Production Stack"
              value="3 Engines"
              text="V96 Crypto / PENGU_DUAL_LS_V2_FINAL / V52 Stock"
              tone="profit"
            />
            <SummaryCard
              title="Portfolio Guard"
              value="Gross 2.5"
              text="Crypto sleeve 1.5 / Stock sleeve 1.5 / 共通Margin Guard"
            />
          </div>
        </section>

        <section className="grid gap-3 xl:grid-cols-3">
          <StrategyCard
            eyebrow="Crypto Core"
            title="V96"
            status="LIVE"
            icon={Activity}
            text="BTC・ETH・BNB・SOLを対象にするCryptoコア。PENGU V2の使用Grossを共有Crypto sleeveから差し引き、合算上限を超えないよう制御します。"
            chips={["BTC / ETH / BNB / SOL", "Sleeve 1.5", "Daily Loss 5%", "Aster Perpetual"]}
          />
          <StrategyCard
            eyebrow="Independent PENGU"
            title="PENGU_DUAL_LS_V2_FINAL"
            status="LIVE"
            icon={TrendingDown}
            text="1時間足の独立Long / Short。Shortは急落後の戻りからの再下抜け、Longは強い72h上昇レジームのブレイクアウトを狙い、ボラティリティ連動でGrossを0.60〜0.75に調整します。"
            chips={["1H Long / Short", "Max Gross 0.75", "V1 Disabled", "6h Cooldown"]}
          />
          <StrategyCard
            eyebrow="US Stock Sleeve"
            title="V52"
            status="SESSION"
            icon={TrendingUp}
            text="AMZN・META・MSFT・NVDA・TSLAを対象とする米国株スリーブ。米国通常市場時間だけworkerを起動し、時間外はWAITING_MARKET_CLOSEDで安全に待機します。"
            chips={["AMZN / META / MSFT / NVDA / TSLA", "Sleeve 1.5", "Max 2 Positions", "Daily Loss 3.5%"]}
          />
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="Leverage" value="5x Cross" text="対象10銘柄をAster Cross 5倍で統一します。" />
          <SummaryCard title="PENGU Gross" value="0.60–0.75" text="ATR24に応じて縮小し、固定上限0.75を超えません。" />
          <SummaryCard title="Margin Guard" value="5 min" text="通常5分、WARNING時は1分周期でMargin状態を監視します。" />
          <SummaryCard title="Safety" value="Fail Closed" text="認証・Parity・state・approval・preflight不一致時は注文を止めます。" />
        </section>

        <section className="panel-gold rounded-[28px] p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <Gauge className="h-4 w-4 text-gold-100" />
            現行リスク配分
          </div>
          <div className="mt-3 grid gap-3 text-[12px] leading-6 text-white/80 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[18px] border border-white/10 bg-white/[0.035] p-3">
              <div className="text-[10px] uppercase tracking-[0.22em] text-gold-100/70">Crypto Sleeve</div>
              <div className="mt-1 text-lg font-black text-white">1.5 Gross</div>
              <div className="mt-1">V96とPENGU V2で共有。</div>
            </div>
            <div className="rounded-[18px] border border-white/10 bg-white/[0.035] p-3">
              <div className="text-[10px] uppercase tracking-[0.22em] text-gold-100/70">Stock Sleeve</div>
              <div className="mt-1 text-lg font-black text-white">1.5 Gross</div>
              <div className="mt-1">V52、最大2ポジション。</div>
            </div>
            <div className="rounded-[18px] border border-white/10 bg-white/[0.035] p-3">
              <div className="text-[10px] uppercase tracking-[0.22em] text-gold-100/70">Combined</div>
              <div className="mt-1 text-lg font-black text-white">2.5 Gross</div>
              <div className="mt-1">全戦略合算のPortfolio上限。</div>
            </div>
            <div className="rounded-[18px] border border-white/10 bg-white/[0.035] p-3">
              <div className="text-[10px] uppercase tracking-[0.22em] text-gold-100/70">Execution</div>
              <div className="mt-1 text-lg font-black text-white">Aster Direct</div>
              <div className="mt-1">認証・reconciliation・Kill Switchを共有。</div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <QuickLink href="/positions" title="運用ダッシュボード" text="現在の運用状況とポジション情報を確認します。" icon={BarChart3} />
          <QuickLink href="/history" title="トレード履歴" text="約定履歴と損益の流れを確認します。" icon={Coins} />
          <QuickLink href="/wallets" title="ウォレット" text="運用資産とウォレット情報を確認します。" icon={Wallet} />
          <QuickLink href="/settings" title="設定" text="認証設定や運用に必要な基本設定を整理します。" icon={Settings} />
        </section>

        <section className="rounded-[22px] border border-gold-400/14 bg-black/25 px-4 py-3 text-[11px] leading-5 text-white/62">
          この画面は現在の固定Production Logicを表示します。実際の注文・建玉・Kill Switch・service状態はVPS側のFail-Closed runtimeを正とし、HP表示だけでLIVE状態を変更しません。
        </section>
      </div>
    </main>
  );
}
