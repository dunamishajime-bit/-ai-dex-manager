'use client';
import { useEffect,useState } from 'react';
import { SignalGateList } from './SignalGateList';
import { currentFetGates,type Gate } from '@/lib/realtime-ranking';
type Snapshot={checkedAt:number;fresh:boolean;gates:Gate[];reason:string;policyVerified:boolean};
export function FetGatePanel(){
 const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(''),[now,setNow]=useState(Date.now());
 useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[]);
 useEffect(()=>{let active=true;const load=async()=>{try{const res=await fetch('/api/system/fet-gates',{cache:'no-store'}),d=await res.json();if(!res.ok||!d.ok)throw Error(d.error||'取得失敗');if(active){setData(d);setError('');}}catch(e){if(active)setError(e instanceof Error?e.message:'取得失敗');}};void load();const timer=setInterval(load,60000);return()=>{active=false;clearInterval(timer);};},[]);
 const fresh=!!data?.fresh&&Math.floor(now/3600000)===Math.floor((data?.checkedAt||0)/3600000);
 const gates=data?currentFetGates(data.gates,data.checkedAt,now):[];
 const reason=gates.filter(g=>g.state==='NO').map(g=>g.label+'：'+g.detail).join(' / ')||'実測済み条件は通過。未確認の発注条件はRunner確認待ち';
 return <section className="panel-gold rounded-[28px] p-4 md:p-6"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="gold-heading text-lg font-bold">FET 発火条件 — OK / NO</h2><span className="text-xs text-white/45">1分更新 {data&&new Date(data.checkedAt).toLocaleString('ja-JP')}</span></div><p className="mt-2 text-xs leading-5 text-white/50">Aster確定1時間足と、現在のProduction判定ソースを照合。受付時刻・共有リスク・発注時の容量確認を分けて表示します。</p>{error&&<p role="alert" className="mt-3 rounded-xl bg-rose-400/10 p-3 text-sm text-rose-200">{error}。前回の結果は現在の判定として扱わないでください。</p>}{data?<><p className="my-4 rounded-xl border border-[#bd9c50]/25 bg-[#b89232]/10 p-3 text-sm leading-6 text-[#f0dfa5]">{error?'更新失敗':!fresh?'現在の判定を確認できません（最新の確定足・Runtime観測待ち）':reason}</p><SignalGateList gates={error?gates.map(g=>({...g,state:'UNKNOWN',detail:'更新失敗：前回値（現在の合否は未確認）'})):gates}/></>:<p className="mt-4 text-sm text-white/50">判定条件を取得中…</p>}</section>;
}
