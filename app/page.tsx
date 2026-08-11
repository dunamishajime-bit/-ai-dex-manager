"use client";

import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Clock3,
  Gauge,
  Settings,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

function Stat({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="panel-gold rounded-[24px] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.26em] text-gold-100/72">{title}</div>
      <div className="mt-2 text-[1.45rem] font-black text-white">{value}</div>
      <div className="mt-1 text-[11px] leading-5 text-white/76">{note}</div>
    </div>
  );
}

function Engine({
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
          <h2 className="mt-2 break-words text-lg font-black text-white">{title}</h2>
        </div>
        <span className="rounded-full border border-profit/30 bg-profit/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-profit">
          {status}
        </span>
      </div>
      <p className="mt-3 text-[12px] leading-6 text-white/80">{text}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span key={chip} className="rounded-full border border-gold-400/18 bg-gold-400/[0.07] px-2.5 py-1 text-[10px] font-semibold text-gold-50">
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}

function NavCard({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <Link href={href} className="group rounded-[22px] border border-gold-400/16 bg-black/25 px-4 py-4 transition hover:border-gold-300/36">
      <div className="flex items-center justify-between gap-3 text-sm font-bold text-white">
        {title}
        <ArrowRight className="h-4 w-4 text-gold-100/70 transition group-hover:translate-x-0.5" />
      </div>
      <p className="mt-2 text-[11px] leading-5 text-white/72">{text}</p>
    </Link>
  );
}

export default function HomePage() {
  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#03050a] text-white shadow-[0_0_30px_rgba(253,224,71,0.06)]">
      <div className="absolute inset-0 bg-[url('/backgrounds/login_bg.png')] bg-cover bg-center opacity-[0.20] mix-blend-screen" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.12),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.05),transparent_28%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(3,5,10,0.12),rgba(3,5,10,0.72))]" />

      <div className="relative z-10 space-y-3 p-3 md:p-4">
        <section className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="panel-gold rounded-[30px] p-4 md:p-5">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.32em] text-gold-100/76">
              <ShieldCheck className="h-3.5 w-3.5" />
              DisDex Current Production Logic
            </div>
            <h1 className="gold-heading mt-3 break-words text-[1.85rem] font-black tracking-tight md:text-[2.75rem]">
              V96 + PENGU_DUAL_LS_V2_FINAL + V52
            </h1>
            <p className="mt-3 max-w-4xl text-sm leading-7 text-white/86 md:text-[15px]">
              現在の本番構成はAster Perpetual上の3エンジンです。Crypto CoreのV96、独立PENGU Long / Shortの
              <span className="font-black text-gold-100"> PENGU_DUAL_LS_V2_FINAL </span>
              、米国株V52を共通のPortfolio Gross・Margin Guard・Fail-Closed Gateで制御します。Legacy PENGU V1は発注しません。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {["Aster Perpetual", "5x Cross", "Combined Gross 2.5", "Fail Closed", "V1 Disabled"].map((item) => (
                <span key={item} className="rounded-full border border-gold-400/20 bg-gold-400/[0.08] px-3 py-1.5 text-[11px] font-semibold text-gold-50">
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <Stat title="Production Engines" value="3" note="V96 / PENGU_DUAL_LS_V2_FINAL / V52" />
            <Stat title="Portfolio Cap" value="2.5 Gross" note="Crypto 1.5 / Stock 1.5を全体上限2.5で制御" />
          </div>
        </section>

        <section className="grid gap-3 xl:grid-cols-3">
          <Engine
            eyebrow="Crypto Core"
            title="V96"
            status="LIVE"
            icon={Activity}
            text="BTC・ETH・BNB・SOLのCrypto Core。PENGU V2とCrypto sleeve 1.5を共有し、V96側Daily Loss 5%のFail-Closed制御下で動作します。"
            chips={["BTC / ETH / BNB / SOL", "Crypto Sleeve 1.5", "Daily Loss 5%", "Aster 5x Cross"]}
          />
          <Engine
            eyebrow="Independent PENGU"
            title="PENGU_DUAL_LS_V2_FINAL"
            status="LIVE"
            icon={TrendingDown}
            text="PENGU専用1H Long / Short。Shortは下降レジームの急落→戻り→再下抜け、Longは強い72h上昇レジームの18h高値Breakoutを狙います。Legacy V1とは独立し、V2だけがPENGU注文オーナーです。"
            chips={["1H", "Long + Short", "Gross 0.60–0.75", "6h Cooldown", "V1 Disabled"]}
          />
          <Engine
            eyebrow="US Stock Sleeve"
            title="V52"
            status="SESSION"
            icon={TrendingUp}
            text="AMZN・META・MSFT・NVDA・TSLAを対象とする米国株エンジン。通常市場時間だけworkerを稼働し、時間外はWAITING_MARKET_CLOSEDで待機します。"
            chips={["AMZN / META / MSFT / NVDA / TSLA", "Stock Sleeve 1.5", "Max 2 Positions", "Daily Loss 3.5%"]}
          />
        </section>

        <section className="panel-gold rounded-[28px] p-4">
          <div className="flex items-center gap-2 text-sm font-black text-white">
            <Gauge className="h-4 w-4 text-gold-100" />
            PENGU_DUAL_LS_V2_FINAL 固定ロジック
          </div>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <div className="rounded-[20px] border border-loss/20 bg-loss/[0.05] p-4">
              <div className="flex items-center gap-2 font-black text-white"><TrendingDown className="h-4 w-4 text-loss" />Short</div>
              <p className="mt-2 text-[12px] leading-6 text-white/78">
                72h騰落率≤0%、24hで-7%以上のImpulseを起点に24h監視。安値から+1.25%以上戻した後、+6%以内で再下抜けし、EMA72&lt;EMA168・BTC比相対弱さ・Volume・RSI等の固定Gateを満たした時だけ次の1H OpenでEntryします。
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold text-gold-50">
                <span className="rounded-full border border-white/10 px-2.5 py-1">Max Hold 72h</span>
                <span className="rounded-full border border-white/10 px-2.5 py-1">Hard Stop 8%</span>
                <span className="rounded-full border border-white/10 px-2.5 py-1">Trail +15% / 4%</span>
              </div>
            </div>
            <div className="rounded-[20px] border border-profit/20 bg-profit/[0.05] p-4">
              <div className="flex items-center gap-2 font-black text-white"><TrendingUp className="h-4 w-4 text-profit" />Long</div>
              <p className="mt-2 text-[12px] leading-6 text-white/78">
                72hで+15%以上、24hで+10%以上の強い上昇レジームを要求し、18h高値Breakout・BTC比Relative・BTC地合い・RSI・Volume・ATR・EMA168の固定条件が揃った最初のBreakoutだけを次の1H OpenでEntryします。
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold text-gold-50">
                <span className="rounded-full border border-white/10 px-2.5 py-1">Max Hold 120h</span>
                <span className="rounded-full border border-white/10 px-2.5 py-1">Hard Stop 8%</span>
                <span className="rounded-full border border-white/10 px-2.5 py-1">Trail +10% / 3%</span>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Stat title="PENGU Gross" value="0.60–0.75" note="ATR24連動。固定上限0.75。" />
          <Stat title="Crypto Daily Loss" value="5%" note="V96 Crypto側のDaily Loss Gate。" />
          <Stat title="Stock Daily Loss" value="3.5%" note="V52 Stock側のDaily Loss Gate。" />
          <Stat title="Margin Guard" value="5 min / 1 min" note="通常5分、WARNING時1分。" />
        </section>

        <section className="panel-gold rounded-[28px] p-4">
          <div className="flex items-center gap-2 text-sm font-black text-white">
            <Clock3 className="h-4 w-4 text-gold-100" />
            実行ポリシー
          </div>
          <div className="mt-3 grid gap-2 text-[12px] leading-6 text-white/78 md:grid-cols-2">
            <div className="rounded-[18px] border border-white/10 bg-white/[0.035] p-3">PENGU V2は最大1ポジション。Short優先、決済後6時間Cooldown。</div>
            <div className="rounded-[18px] border border-white/10 bg-white/[0.035] p-3">Aster対象10銘柄は5x Cross。Portfolio Gross全体上限は2.5。</div>
            <div className="rounded-[18px] border border-white/10 bg-white/[0.035] p-3">V52は通常市場時間のみworker稼働。時間外はWAITING_MARKET_CLOSED。</div>
            <div className="rounded-[18px] border border-white/10 bg-white/[0.035] p-3">認証・state・approval・parity・preflight不一致時はFail Closed。</div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3">
          <NavCard href="/positions" title="現行ロジック・運用ダッシュボード" text="3エンジンと固定リスクポリシーを確認します。" />
          <NavCard href="/history" title="トレード履歴" text="保存されている取引履歴を確認します。" />
          <NavCard href="/settings" title="設定" text="HP側の認証・基本設定を確認します。" />
        </section>

        <section className="rounded-[22px] border border-gold-400/14 bg-black/25 px-4 py-3 text-[11px] leading-5 text-white/62">
          HPは固定Production Logicを表示します。実際の注文・建玉・Kill Switch・service・Aster残高などの瞬間状態はVPSのFail-Closed runtimeを正とし、HP表示からLIVEロジックを変更しません。
        </section>
      </div>
    </main>
  );
}
