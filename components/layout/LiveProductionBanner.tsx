import { Activity, ShieldCheck } from "lucide-react";

export function LiveProductionBanner() {
  return (
    <section className="border-b border-amber-400/15 bg-[#151207] px-3 py-2 md:px-6">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-white/80">
        <span className="inline-flex items-center gap-1.5 font-bold text-amber-100">
          <Activity className="h-3.5 w-3.5" />
          V96 Crypto + V52 Stock
        </span>
        <span>AsterDEX</span>
        <span>LIVE状態: 未確認</span>
        <span>V96 Daily Loss 5%</span>
        <span>V52 Daily Loss 3.5%</span>
        <span>最大Gross 1.0</span>
        <span>PENGU初期Gross 0.15</span>
        <span className="inline-flex items-center gap-1 text-amber-100">
          <ShieldCheck className="h-3.5 w-3.5" />
          Execution Parity / Operator Override / Kill Switch
        </span>
      </div>
    </section>
  );
}
