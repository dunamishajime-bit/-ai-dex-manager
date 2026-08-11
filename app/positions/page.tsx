"use client";

import {
  Activity,
  Gauge,
  Layers3,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="panel-gold rounded-[24px] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/72">{label}</div>
      <div className="mt-2 text-[1.35rem] font-black text-white">{value}</div>
      <div className="mt-1 text-[11px] leading-5 text-white/78">{detail}</div>
    </div>
  );
}

function Gate({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/[0.035] p-3">
      <div className="text-[10px] uppercase tracking-[0.22em] text-gold-100/70">{title}</div>
      <div className="mt-1 text-lg font-black text-white">{value}</div>
      <div className="mt-1 text-[11px] leading-5 text-white/68">{note}</div>
    </div>
  );
}

export default function PositionsPage() {
  return (
    <main className="relative min-h-full overflow-hidden rounded-[28px] border border-gold-400/16 bg-[#04060a] p-3 text-white shadow-[0_0_30px_rgba(253,224,71,0.07)]">
      <div className="pointer-events-none absolute inset-0 bg-[url('/backgrounds/login_bg.png')] bg-cover bg-center opacity-[0.18] mix-blend-screen" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,224,71,0.10),transparent_20%),radial-gradient(circle_at_bottom_right,rgba(56,189,248,0.05),transparent_24%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(3,5,10,0.18),rgba(3,5,10,0.72))]" />

      <div className="relative z-10 space-y-3">
        <header className="panel-gold rounded-[30px] p-4 md:p-5">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.34em] text-gold-100/72">
            <ShieldCheck className="h-3.5 w-3.5" />
            Current Production Dashboard
          </div>
          <h1 className="gold-heading mt-2 break-words text-[1.7rem] font-black tracking-tight sm:text-[2rem] md:text-[2.7rem]">
            V96 + PENGU_DUAL_LS_V2_FINAL + V52
          </h1>
          <p className="mt-2 max-w-4xl text-sm leading-7 text-white/82">
            現在の本番ロジックと固定リスク設定を読み取り専用で表示します。この画面から注文・取消・建玉変更は行えません。
          </p>
        </header>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Execution" value="Aster" detail="Perpetual / 5x Cross" />
          <Metric label="Engines" value="3" detail="V96 / PENGU_DUAL_LS_V2_FINAL / V52" />
          <Metric label="Portfolio Cap" value={`${config.maximumGross.toFixed(1)} Gross`} detail={`Crypto ${config.v96CryptoGross.toFixed(1)} / Stock ${config.v52StockGross.toFixed(1)}`} />
          <Metric label="Safety" value="Fail Closed" detail="Approval・Parity・Preflight・Stateを検証" />
        </section>

        <section className="grid gap-3 xl:grid-cols-3">
          <div className="panel-gold rounded-[28px] p-4">
            <div className="flex items-center gap-2 text-sm font-black text-white">
              <Activity className="h-4 w-4 text-gold-100" />
              V96 Crypto Core
            </div>
            <p className="mt-3 text-[12px] leading-6 text-white/78">
              BTC・ETH・BNB・SOLを対象にするCrypto Core。PENGU V2とCrypto sleeveを共有し、Portfolio上限を超えないよう統合制御します。
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Gate title="Crypto Sleeve" value={config.v96CryptoGross.toFixed(1)} note="V96 + PENGU V2で共有" />
              <Gate title="Daily Loss" value="5%" note="V96 Crypto側Gate" />
            </div>
          </div>

          <div className="panel-gold rounded-[28px] p-4">
            <div className="flex items-center gap-2 text-sm font-black text-white">
              <TrendingDown className="h-4 w-4 text-loss" />
              PENGU_DUAL_LS_V2_FINAL
            </div>
            <p className="mt-3 text-[12px] leading-6 text-white/78">
              PENGU専用の独立1H Long / Short。Legacy V1は停止し、PENGUのLIVE注文オーナーはV2 FINALのみです。
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Gate title="Gross" value="0.60–0.75" note="ATR24連動・上限0.75" />
              <Gate title="Cooldown" value="6h" note="最大1ポジション・Short優先" />
            </div>
          </div>

          <div className="panel-gold rounded-[28px] p-4">
            <div className="flex items-center gap-2 text-sm font-black text-white">
              <TrendingUp className="h-4 w-4 text-profit" />
              V52 US Stock
            </div>
            <p className="mt-3 text-[12px] leading-6 text-white/78">
              AMZN・META・MSFT・NVDA・TSLAを対象。米国通常市場時間だけworkerを稼働し、時間外はWAITING_MARKET_CLOSEDで待機します。
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Gate title="Stock Sleeve" value={config.v52StockGross.toFixed(1)} note="最大2ポジション" />
              <Gate title="Daily Loss" value="3.5%" note="V52 Stock側Gate" />
            </div>
          </div>
        </section>

        <section className="panel-gold rounded-[28px] p-4">
          <div className="flex items-center gap-2 text-sm font-black text-white">
            <Layers3 className="h-4 w-4 text-gold-100" />
            PENGU_DUAL_LS_V2_FINAL Entry / Exit
          </div>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <div className="rounded-[22px] border border-loss/20 bg-loss/[0.05] p-4">
              <div className="font-black text-white">SHORT — 急落後Pullback / Rebreak</div>
              <div className="mt-2 space-y-1 text-[12px] leading-6 text-white/78">
                <p>72h PENGU return ≤ 0%、24h return ≤ -7%でImpulse開始。</p>
                <p>24h以内に安値から+1.25%以上戻し、+6%超ならsetup無効。</p>
                <p>再下抜け時に close&lt;prev 1h low、close&lt;EMA72、EMA72&lt;EMA168、BTC比相対弱さ≤-2%、Volume ratio 0.25–3.0、BTC24h≤+4%、PENGU24h≥-12%、BTC/EMA168乖離≥-4%、RSI14≥30を要求。</p>
                <p>次の1H OpenでEntry。最大72h、Hard Stop 8%、+15% favorable後4%Trailing。</p>
              </div>
            </div>

            <div className="rounded-[22px] border border-profit/20 bg-profit/[0.05] p-4">
              <div className="font-black text-white">LONG — Strong Trend Breakout</div>
              <div className="mt-2 space-y-1 text-[12px] leading-6 text-white/78">
                <p>72h PENGU return ≥ +15%、24h return ≥ +10%を要求。</p>
                <p>close&gt;prior 18h high、BTC比Relative≥+1%、BTC24h≥0%、RSI14 48–78、Volume ratio 0.25–3.0、ATR24/close≤5%、close&gt;EMA168。</p>
                <p>rising-edgeの最初のBreakoutだけを次の1H OpenでEntry。</p>
                <p>最大120h、Hard Stop 8%、+10% favorable後3%Trailing。</p>
              </div>
            </div>
          </div>
        </section>

        <section className="panel-gold rounded-[28px] p-4">
          <div className="flex items-center gap-2 text-sm font-black text-white">
            <Gauge className="h-4 w-4 text-gold-100" />
            Production Risk Policy
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Gate title="Leverage" value="5x Cross" note="Aster対象10銘柄" />
            <Gate title="Portfolio" value={`${config.maximumGross.toFixed(1)} Gross`} note="V96 Portfolio上限" />
            <Gate title="PENGU Cap" value="0.75" note="V2固定仕様の実行上限" />
            <Gate title="Margin Guard" value="5m / 1m" note="通常5分・WARNING時1分" />
          </div>
        </section>

        <section className="rounded-[22px] border border-gold-400/14 bg-black/25 px-4 py-3 text-[11px] leading-5 text-white/62">
          現行Production Logicの読み取り専用画面です。リアルタイムのposition、pending、Open Orders、Kill Switch、MainPID、Aster残高はVPS runtimeを正とし、取得不能時は推測表示しません。
        </section>
      </div>
    </main>
  );
}
