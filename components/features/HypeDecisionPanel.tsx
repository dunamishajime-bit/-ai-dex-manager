"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, ShieldCheck } from "lucide-react";
import type { HypeOverview, HypeSleeve } from "@/lib/server/hype-runtime-observability";
type Strategy="HYPE_LONG";
const badge=(s:HypeSleeve["status"])=>s==="LIVE"?"border-emerald-400/40 bg-emerald-500/10 text-emerald-200":
  s==="SHADOW"?"border-sky-400/40 bg-sky-500/10 text-sky-200":
  "border-amber-400/40 bg-amber-500/10 text-amber-200";
const tone=(s:string)=>s==="PASS"?"border-emerald-400/25 bg-emerald-500/10 text-emerald-100":
  s==="BLOCKED"?"border-rose-400/25 bg-rose-500/10 text-rose-100":
  "border-amber-400/25 bg-amber-500/10 text-amber-100";
function dt(v?:number|string){if(v===undefined)return "未取得";const n=typeof v==="number"?v:Date.parse(v);return Number.isFinite(n)?new Date(n).toLocaleString("ja-JP"):"未取得";}
const labels:Record<HypeSleeve["status"],string>={
  LIVE:"LIVE（実Runner確認）",SHADOW:"SHADOW（注文停止）",STALE:"更新停止",
  BLOCKED:"本番SHA不一致",NOT_DEPLOYED:"本番未実装",UNCONFIRMED:"稼働未確認 / 要確認",
};
export function HypeDecisionPanel({strategy}:{strategy:Strategy}){
  const [data,setData]=useState<HypeOverview|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{
    try{
      const r=await fetch("/api/system/hype-status",{cache:"no-store"});
      const j=await r.json() as HypeOverview&{error?:string};
      if(!r.ok||j.readOnly!==true)throw new Error(j.error||"実Runnerの取得失敗");
      setData(j);setError(null);
    }catch(e){setError(e instanceof Error?e.message:"判定取得失敗");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),30_000);return()=>window.clearInterval(timer);},[load]);
  const row=data?.sleeves[strategy],logic="HYPE";
  return <div className="space-y-4">
    <nav className="flex min-w-0 flex-wrap gap-2 text-xs font-bold">
      <Link className="rounded-lg border border-white/20 px-3 py-2 text-white/75" href="/decision-status">← 判定状況</Link>
      <Link className="rounded-lg border border-white/20 px-3 py-2 text-white/75" href="/decision-status/hype">HYPE</Link>
      <button onClick={()=>void load()} className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-white/75">
        <RefreshCw size={14} className={loading?"animate-spin":""}/>更新
      </button>
    </nav>
    {error?<p className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-rose-100">取得失敗: {error}</p>:null}
    <section className="panel-gold min-w-0 overflow-hidden rounded-[26px] p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black text-white">{logic} / {row?.symbol||"取得中"}</h2>
        {row?<span className={"rounded-full border px-3 py-1.5 text-xs font-bold "+badge(row.status)}>{labels[row.status]}</span>:null}
      </div>
      <p className="mt-3 break-words text-xs leading-5 text-white/70">{row?.note||"Production stateを取得中…"}</p>
      <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["本番Runtime SHA",data?.releaseSha?.slice(0,12)||"未取得"],
          ["state SHA",row?.stateSha?.slice(0,12)||"未取得"],
          ["mode",row?.stateMode||"未取得"],
          ["実設定Gross上限",row?.maxGross===undefined?"未取得":row.maxGross+"x"],
          ["実設定STOPリスク",row?.riskPct===undefined?"未取得":row.riskPct+"%"],
          ["state更新",dt(row?.stateUpdatedAt)],
          ["本番サービス",row?.serviceActive?"active":"未確認"],
          ["Shared Kill Switch",data?.sharedKillActive==null?"未取得":data?.sharedKillActive?"ON":"OFF"],
          ["公開足の発火条件",row?.publicSignalEligible===null?"未取得":row?.publicSignalEligible?"成立（発注とは別）":"未成立"],
          ["実Runner最終判定",row?.lastDecision?.reason||"対象通貨の最新記録なし"],
        ].map(([label,value])=><div key={label} className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
          <div className="text-[11px] text-white/45">{label}</div><div className="mt-1 break-all text-sm font-semibold text-white/85">{value}</div>
        </div>)}
      </div>
      {row?.manualReview?<p className="mt-3 rounded-xl border border-amber-400/30 p-3 text-xs text-amber-200">manualReview: {row.manualReview}</p>:null}
      {row?.position?<p className="mt-3 text-sm text-white/85">建玉 {row.position.quantity} / Entry {row.position.entryPrice} / STOP {row.position.stopPrice} / TP {row.position.takeProfitPrice}</p>:
        <p className="mt-3 text-xs text-white/60">このRunnerの対象建玉stateなし。Asterの実口座照合とは別です。</p>}
    </section>
    <section className="panel-gold min-w-0 overflow-hidden rounded-[26px] p-4 md:p-5">
      <div className="flex items-center gap-2 text-sm font-bold text-white">
        <ShieldCheck size={17}/>エントリーまでのGate（各条件を独立評価）
      </div>
      <p className="mt-2 text-xs leading-5 text-white/55">公開足由来のPASSは注文可能や実約定を意味しません。5x Cross・共有Gross・保護注文は実Runnerの事前照合が必要です。</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(row?.gates||[]).map(g=><article key={g.key} className={"min-w-0 rounded-xl border p-3 "+tone(g.status)}>
          <div className="flex flex-wrap items-center justify-between gap-1 text-xs font-bold"><span>{g.label}</span><span>{g.status==="PASS"?"合格":g.status==="BLOCKED"?"不合格":"未確認"}</span></div>
          <div className="mt-2 text-sm">実測: {g.actual??"未取得"}</div>
          <div className="text-xs opacity-75">基準: {g.threshold??"未取得"}</div>
          <p className="mt-2 break-words text-xs leading-5 opacity-90">{g.reason}</p>
          <div className="mt-1 text-[10px] opacity-60">{g.source}</div>
        </article>)}
      </div>
      {row?.publicError?<p className="mt-3 text-xs text-amber-100">公開足の取得: {row.publicError}</p>:null}
      <div className="mt-4 text-xs text-white/55">参照足: {dt(row?.publicReferenceTs)} / 取得時刻: {dt(data?.capturedAt)}</div>
    </section>
  </div>;
}
