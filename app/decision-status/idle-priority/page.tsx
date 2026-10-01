"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Row = {
  symbol: string;
  route: string;
  features: {
    ret12: number; ret24: number; btc24: number; rel24: number; atrRatio: number; volumeRatio: number;
    breakoutLong24: boolean; breakoutShort24: boolean; breakdown24: boolean;
  };
  generic: { accepted: boolean; archetype: string | null; side: string; reason: string };
  routeDecision: { accepted: boolean; side: string; reason: string; holdHours: number };
  cooldownAllowed: boolean;
  lastLifecycleTs: number | null;
};
type ResidualRow = {
  symbol: string; route: string; features: Row["features"];
  decision: { accepted: boolean; side: string; reason: string; holdHours: number; priority: number };
};
type Payload = {
  ok: boolean; status?: string; releaseSha?: string; heartbeat?: any; baseline?: any; state?: any; residualState?: any;
  details?: { decisionTs: number; updatedAt: number; symbols: Row[]; residual: ResidualRow[]; finalReason?: string };
};

const pct=(v:number|undefined)=>Number.isFinite(Number(v))?`${(Number(v)*100).toFixed(2)}%`:"—";
const num=(v:number|undefined,d=2)=>Number.isFinite(Number(v))?Number(v).toFixed(d):"—";
const ts=(v:number|null|undefined)=>v?new Date(v).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"}):"—";

function Gate({label,ok,value}:{label:string;ok?:boolean;value:string}){
  return <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
    <span className="text-[10px] text-white/55">{label}</span>
    <span className={`text-[11px] font-bold ${ok===undefined?"text-white/85":ok?"text-emerald-300":"text-rose-300"}`}>{value}</span>
  </div>;
}

export default function IdlePriorityDecisionPage(){
  const [data,setData]=useState<Payload|null>(null);
  const [error,setError]=useState("");
  const load=useCallback(async()=>{
    try{
      const response=await fetch(`/api/system/idle-priority-status?t=${Date.now()}`,{cache:"no-store"});
      const body=await response.json();
      if(!response.ok||!body.ok)throw new Error(body.error||`HTTP ${response.status}`);
      setData(body);setError("");
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  },[]);
  useEffect(()=>{void load();const id=setInterval(()=>void load(),30_000);return()=>clearInterval(id);},[load]);

  const details=data?.details;
  const baseline=data?.baseline;
  return <main className="space-y-4 p-4 text-white">
    <header className="panel-gold rounded-[28px] p-5">
      <div className="text-[10px] uppercase tracking-[0.28em] text-gold-100/70">Idle Priority + Residual LONG</div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-black">Idle Priority 判定状況</h1>
        <p className="mt-2 text-sm text-white/75">Formal → Idle SHORT → DOGE → AVAX の順で評価。上位シグナルを下位ルートが押し退けることはありません。</p></div>
        <button onClick={()=>void load()} className="rounded-xl border border-white/15 px-3 py-2 text-xs">更新</button>
      </div>
      <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
        <Gate label="Runtime" value={data?.status||"LOADING"} />
        <Gate label="Release SHA" value={data?.releaseSha?.slice(0,12)||"—"} />
        <Gate label="Decision JST" value={ts(details?.decisionTs)} />
        <Gate label="Snapshot JST" value={ts(details?.updatedAt)} />
      </div>
      {error&&<div className="mt-3 rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-xs text-rose-200">{error}</div>}
    </header>

    <section className="panel-gold rounded-[24px] p-4">
      <div className="mb-3 text-sm font-black">共通 Admission</div>
      <div className="grid gap-2 md:grid-cols-4">
        <Gate label="Source Complete" ok={baseline?.sourceComplete===true} value={baseline?.sourceComplete===true?"PASS":"BLOCK"} />
        <Gate label="Formal Open" ok={Number(baseline?.baselineOpenPositions||0)===0} value={String(baseline?.baselineOpenPositions??"—")} />
        <Gate label="Formal Pending" ok={Number(baseline?.baselinePendingExposure||0)===0} value={num(baseline?.baselinePendingExposure,3)} />
        <Gate label="Same Timestamp" ok={Number(baseline?.baselineAcceptedThisTimestamp||0)===0} value={String(baseline?.baselineAcceptedThisTimestamp??"—")} />
      </div>
      <div className="mt-2 text-[11px] text-white/55">最終理由: {details?.finalReason||data?.state?.lastDecision?.reason||"—"}</div>
    </section>

    <section>
      <h2 className="mb-3 text-lg font-black">Idle SHORT 全対象通貨</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {(details?.symbols||[]).map((row)=><article key={row.symbol} className="panel-gold rounded-[22px] p-4">
          <div className="flex items-center justify-between gap-2">
            <div><div className="text-lg font-black">{row.symbol.replace("USDT","")}</div><div className="text-[9px] text-gold-100/65">{row.route}</div></div>
            <div className={`rounded-full px-2 py-1 text-[10px] font-black ${row.routeDecision.accepted&&row.cooldownAllowed?"bg-emerald-400/15 text-emerald-300":"bg-white/8 text-white/55"}`}>{row.routeDecision.accepted&&row.cooldownAllowed?"候補":"待機"}</div>
          </div>
          <div className="mt-3 grid gap-1.5">
            <Gate label="Ret 12h" value={pct(row.features.ret12)} />
            <Gate label="Ret 24h" value={pct(row.features.ret24)} />
            <Gate label="BTC 24h" value={pct(row.features.btc24)} />
            <Gate label="BTC比 24h" value={pct(row.features.rel24)} />
            <Gate label="Volume Ratio" value={num(row.features.volumeRatio,3)} />
            <Gate label="ATR Ratio" value={pct(row.features.atrRatio)} />
            <Gate label="Breakout ↑" ok={row.features.breakoutLong24} value={row.features.breakoutLong24?"YES":"NO"} />
            <Gate label="Breakdown ↓" ok={row.features.breakoutShort24} value={row.features.breakoutShort24?"YES":"NO"} />
            <Gate label="Generic" ok={row.generic.accepted} value={`${row.generic.side} / ${row.generic.archetype||"—"}`} />
            <Gate label="Route Gate" ok={row.routeDecision.accepted} value={row.routeDecision.reason} />
            <Gate label="Cooldown" ok={row.cooldownAllowed} value={row.cooldownAllowed?"PASS":"ACTIVE"} />
          </div>
          <div className="mt-2 text-[10px] text-white/45">Last lifecycle: {ts(row.lastLifecycleTs)}</div>
        </article>)}
      </div>
    </section>

    <section>
      <h2 className="mb-3 text-lg font-black">下位補完 LONG</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {(details?.residual||[]).map((row)=><article key={row.symbol} className="panel-gold rounded-[22px] p-4">
          <div className="flex items-center justify-between"><div><div className="text-lg font-black">{row.symbol.replace("USDT","")}</div><div className="text-[9px] text-gold-100/65">{row.route}</div></div>
          <div className={`rounded-full px-2 py-1 text-[10px] font-black ${row.decision.accepted?"bg-emerald-400/15 text-emerald-300":"bg-white/8 text-white/55"}`}>{row.decision.accepted?"候補":"待機"}</div></div>
          <div className="mt-3 grid gap-1.5 md:grid-cols-2">
            <Gate label="BTC比 24h" value={pct(row.features.rel24)} />
            <Gate label="Volume Ratio" value={num(row.features.volumeRatio,3)} />
            <Gate label="ATR Ratio" value={pct(row.features.atrRatio)} />
            <Gate label="Route Gate" ok={row.decision.accepted} value={row.decision.reason} />
            <Gate label="保有上限" value={`${row.decision.holdHours}h`} />
            <Gate label="優先順位" value={String(row.decision.priority)} />
          </div>
        </article>)}
      </div>
    </section>

    <Link href="/positions" className="inline-block text-sm text-gold-100">← ダッシュボード</Link>
  </main>;
}
