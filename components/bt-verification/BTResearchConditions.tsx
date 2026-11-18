"use client";

import { useState } from "react";
import type { Replay } from "@/lib/bt-verification/replay";
import {createAnchoredChartReplay} from "@/lib/bt-verification/anchored-replay";

type DataMode = "SYNTHETIC" | "BASELINE";
type StrategyKey = "V4" | "PENGU" | "Q102" | "V52" | "FET" | "HYPE" | "IDLE";
const STRATEGIES: StrategyKey[] = ["V4", "PENGU", "Q102", "V52", "FET", "HYPE", "IDLE"];
/** Research ledger candidates only: not a current production route inventory. */
const LEDGER_SYMBOLS:Record<StrategyKey,string[]>={
 V4:["AAVEUSDT","ADAUSDT","ATOMUSDT","AVAXUSDT","BNBUSDT","BTCUSDT","DOGEUSDT","ETHUSDT","INJUSDT","LINKUSDT","LTCUSDT","NEARUSDT","SOLUSDT","XRPUSDT"],
 PENGU:["PENGUUSDT"],
 Q102:["APTUSDT","AVAXUSDT","DOGEUSDT","FETUSDT","NEARUSDT","RENDERUSDT","UNIUSDT"],
 V52:[],
 FET:["FETUSDT"],HYPE:["HYPEUSDT"],
 IDLE:["DOTUSDT","JUPUSDT","RENDERUSDT","TAOUSDT","TIAUSDT"]
};
const field = "w-full rounded-lg border border-[#365a70] bg-[#0a1b2b] px-3 py-2 text-sm text-white";
const label = "block text-xs font-semibold text-[#a5c1d3]";
const yesterdayJst = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const get=(key:string)=>parts.find((p)=>p.type===key)?.value??"";
  const today=new Date(Date.UTC(Number(get("year")),Number(get("month"))-1,Number(get("day"))));
  today.setUTCDate(today.getUTCDate()-1);
  return today.toISOString().slice(0,10);
};
export function BTResearchConditions({onReplay,onOpenLibrary}:{onReplay:(replay:Replay)=>void;onOpenLibrary:()=>void}) {
  const [mode,setMode]=useState<DataMode>("SYNTHETIC");
  const [start,setStart]=useState("2026-01-01");
  const [end,setEnd]=useState("2026-08-31");
  const [capital,setCapital]=useState("10000");
  const [interest,setInterest]=useState<"COMPOUND"|"SIMPLE">("COMPOUND");
  const [deposit,setDeposit]=useState(false);
  const [depositAmount,setDepositAmount]=useState("10000");
  const [frequency,setFrequency]=useState<"MONTHLY"|"WEEKLY">("MONTHLY");
  const [day,setDay]=useState("1");
  const [cost,setCost]=useState("30");
  const [selected,setSelected]=useState<StrategyKey[]>(["V4","PENGU","Q102"]);
  const [symbols,setSymbols]=useState<string[]>(["BTCUSDT","FETUSDT"]);
  const [seed,setSeed]=useState("123456");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const candidateSymbols=Array.from(new Set(selected.flatMap(strategy=>LEDGER_SYMBOLS[strategy]))).sort();
  const enabledSymbols=candidateSymbols.filter(symbol=>symbols.includes(symbol));
  async function startAnchoredChart(){
    if(busy||!valid||mode!=="SYNTHETIC")return;
    setBusy(true);setMessage("");
    try {
      const requested=Array.from(new Set(["BTCUSDT",...enabledSymbols]));
      const anchored:{symbol:string;anchorClose:number}[]=[];
      let utcDate="";
      // Bounded concurrency avoids rate spikes against the public market API.
      for(let i=0;i<requested.length;i+=4){
        const batch=await Promise.all(requested.slice(i,i+4).map(async symbol=>{
          const res=await fetch("/api/bt-verification/anchors?symbol="+encodeURIComponent(symbol),
            {method:"GET",credentials:"same-origin",cache:"no-store"});
          const data:unknown=await res.json();
          if(!res.ok||!data||typeof data!=="object")throw new Error(symbol+" の実終値を検証できません（HTTP "+res.status+"）。");
          const d=data as {close?:unknown;utcDate?:unknown;symbol?:unknown};
          if(d.symbol!==symbol||typeof d.utcDate!=="string"||!Number.isFinite(d.close)||Number(d.close)<=0)
            throw new Error(symbol+" の終値応答が不正です。");
          return {symbol,anchorClose:Number(d.close),utcDate:d.utcDate};
        }));
        for(const item of batch){
          if(utcDate&&utcDate!==item.utcDate)throw new Error("銘柄の基準日が一致しません。");
          utcDate=item.utcDate;
          anchored.push({symbol:item.symbol,anchorClose:item.anchorClose});
        }
      }
      const replay=createAnchoredChartReplay({
        startDate:start,endDate:end,seed:Number(seed),initialJpy:Number(capital),
        anchorUtcDate:utcDate,symbols:anchored,costBps:Number(cost) as 10|30,interest,
        contribution:deposit?{amountJpy:Number(depositAmount),frequency,day:Number(day)}:undefined
      });
      onReplay(replay);
    }catch(error){setMessage(error instanceof Error?error.message:"生成に失敗しました。");}
    finally{setBusy(false);}
  }
  const maxEnd=yesterdayJst();
  const validDates=start.length===10&&end.length===10&&start<=end&&end<=maxEnd;
  const validCapital=Number.isFinite(Number(capital))&&Number(capital)>0;
  const validDeposit=!deposit||(Number.isFinite(Number(depositAmount))&&Number(depositAmount)>0);
  const valid=validCapital&&validDeposit&&(mode==="BASELINE"||validDates)&&selected.length>0;
  return <section className="rounded-xl border border-[#29475b] bg-[linear-gradient(145deg,#13283b,#0d1e30)] p-4 shadow-[0_8px_32px_rgba(1,10,26,.16)]">
    <h2 className="text-lg font-bold text-white">BT条件設定・模擬価格研究</h2>
    <p className="mt-2 text-xs leading-6 text-[#95b5ca]">終値アンカー型チャート生成は実行可能です。Productionロジックの判定・約定はまだ接続されていません。従来デモ再生とも独立しています。</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <div><label className={label} htmlFor="bt-mode">データモード</label><select id="bt-mode" className={field+" mt-2"} value={mode} onChange={e=>setMode(e.target.value as DataMode)}>
        <option value="SYNTHETIC">模擬チャート（終値アンカー型）</option><option value="BASELINE">基準BT（実市場データ）</option>
      </select></div>
      <div><label className={label}>データセット</label><div className="mt-2 rounded-lg border border-[#365a70] bg-[#0a1b2b] p-2 text-xs text-[#bed1e0]">
        {mode==="BASELINE"?"2025/10/01 00:00 UTC 〜 2026/10/01 00:00 UTC（終端除外）":"前日実終値を模擬期間最終日に固定して過去方向へ生成"}
      </div></div>
      {mode==="SYNTHETIC"&&<>
        <div><label className={label} htmlFor="bt-start">模擬開始日</label><input id="bt-start" type="date" className={field+" mt-2"} value={start} max={maxEnd} onChange={e=>setStart(e.target.value)}/></div>
        <div><label className={label} htmlFor="bt-end">模擬終了日（前日まで）</label><input id="bt-end" type="date" className={field+" mt-2"} value={end} max={maxEnd} min={start} onChange={e=>setEnd(e.target.value)}/></div>
      </>}
      <div><label className={label} htmlFor="bt-capital">スタート資金（円）</label><input id="bt-capital" type="number" min="1" step="1" className={field+" mt-2"} value={capital} onChange={e=>setCapital(e.target.value)}/></div>
      <div><label className={label} htmlFor="bt-interest">運用方式</label><select id="bt-interest" className={field+" mt-2"} value={interest} onChange={e=>setInterest(e.target.value as "COMPOUND"|"SIMPLE")}><option value="COMPOUND">複利</option><option value="SIMPLE">単利</option></select></div>
      <div><label className={label} htmlFor="bt-cost">取引コスト</label><select id="bt-cost" className={field+" mt-2"} value={cost} onChange={e=>setCost(e.target.value)}><option value="10">10 bps</option><option value="30">30 bps</option></select></div>
      <div className="flex items-center gap-2"><input id="bt-deposit" type="checkbox" checked={deposit} onChange={e=>setDeposit(e.target.checked)} className="accent-cyan-400"/><label htmlFor="bt-deposit" className="text-sm text-[#bed1e0]">定期積立を有効にする</label></div>
      {deposit&&<>
        <div><label className={label} htmlFor="bt-deposit-amount">積立金額（円）</label><input id="bt-deposit-amount" type="number" min="1" step="1" className={field+" mt-2"} value={depositAmount} onChange={e=>setDepositAmount(e.target.value)}/></div>
        <div><label className={label} htmlFor="bt-deposit-frequency">積立頻度</label><select id="bt-deposit-frequency" className={field+" mt-2"} value={frequency} onChange={e=>setFrequency(e.target.value as "MONTHLY"|"WEEKLY")}><option value="MONTHLY">毎月</option><option value="WEEKLY">毎週</option></select></div>
        <div><label className={label} htmlFor="bt-deposit-day">{frequency==="MONTHLY"?"積立日（1〜28日）":"積立曜日"}</label><select id="bt-deposit-day" className={field+" mt-2"} value={day} onChange={e=>setDay(e.target.value)}>{Array.from({length:frequency==="MONTHLY"?28:7},(_,i)=><option key={i} value={String(i+1)}>{frequency==="MONTHLY"?i+1+"日":["月","火","水","木","金","土","日"][i]+"曜日"}</option>)}</select></div>
      </>}
    </div>
    <fieldset className="mt-5"><legend className={label}>対象ロジック（研究画面内のみ・本番稼働状態は変更しません）</legend>
      <div className="mt-2 flex flex-wrap gap-3">{STRATEGIES.map(s=><label key={s} className="flex items-center gap-2 rounded-lg border border-[#365a70] bg-[#0a1b2b] px-3 py-2 text-sm text-[#c8d9e6]"><input type="checkbox" checked={selected.includes(s)} onChange={e=>setSelected(p=>e.target.checked?[...p,s]:p.filter(v=>v!==s))} className="accent-cyan-400"/>{s}</label>)}</div>
    </fieldset>
    <p role="status" className={"mt-4 text-xs "+(valid?"text-[#9ccbd6]":"text-amber-300")}>{!valid?"入力値・期間・ロジック選択を確認してください。":"設定内容は入力可能です。実行エンジン未接続のため本番一致BTは開始できません。"}</p>
  </section>;
}