 "use client";
import {useEffect,useState} from "react";
import type {Replay,Position} from "@/lib/bt-verification/replay";
import {isStock,validateReplay,grossForFrame,serializeCsv} from "@/lib/bt-verification/replay";
import {saveRun,listRuns,readRun,deleteRun,type SavedRun} from "@/lib/bt-verification/storage";
import {makeZip,type ZipEntry} from "@/lib/bt-verification/zip-store";
import {BtcCandlestickChart} from "@/components/bt-verification/BtcCandlestickChart";
import {EquityTimelineChart} from "@/components/bt-verification/EquityTimelineChart";
import {GrossAllocationPanel} from "@/components/bt-verification/GrossAllocationPanel";
const LIMITS={total:3.5,crypto:3,stock:1.5};
const DEMO:Replay={schema:"disdex-bt-portfolio-v1",mode:"DEMO",engineSha:"DEMO_ONLY_NOT_CANONICAL",seed:123456,limits:LIMITS,frames:[
{timestamp:"2025-10-01T00:00:00Z",btc:108200,equity:10000,realized:0,positions:[],events:[]},
{timestamp:"2025-10-02T00:00:00Z",btc:109300,equity:10028,realized:0,positions:[{id:"v4-1",logic:"V4",symbol:"BTC",side:"LONG",quantity:0.03,entry:108200,mark:109300,gross:0.4,openedAt:"2025-10-02T00:00:00Z"}],events:["V4 BTC LONG 発火"]},
{timestamp:"2025-10-03T00:00:00Z",btc:107400,equity:9950,realized:0,positions:[{id:"v4-1",logic:"V4",symbol:"BTC",side:"LONG",quantity:0.03,entry:108200,mark:107400,gross:0.4,openedAt:"2025-10-02T00:00:00Z"},{id:"pengu-1",logic:"PENGU",symbol:"PENGU",side:"SHORT",quantity:120,entry:0.034,mark:0.035,gross:0.35,openedAt:"2025-10-03T00:00:00Z"}],events:["PENGU SHORT 発火"]},
{timestamp:"2025-10-04T00:00:00Z",btc:110300,equity:10060,realized:0,positions:[{id:"v4-1",logic:"V4",symbol:"BTC",side:"LONG",quantity:0.03,entry:108200,mark:110300,gross:0.4,openedAt:"2025-10-02T00:00:00Z"},{id:"pengu-1",logic:"PENGU",symbol:"PENGU",side:"SHORT",quantity:120,entry:0.034,mark:0.033,gross:0.35,openedAt:"2025-10-03T00:00:00Z"},{id:"q102-1",logic:"Q102",symbol:"AVAX",side:"LONG",quantity:9,entry:32,mark:33,gross:0.25,openedAt:"2025-10-04T00:00:00Z"}],events:["Q102 AVAX LONG 発火"]},
{timestamp:"2025-10-05T00:00:00Z",btc:112000,equity:10110,realized:65,positions:[{id:"pengu-1",logic:"PENGU",symbol:"PENGU",side:"SHORT",quantity:120,entry:0.034,mark:0.032,gross:0.35,openedAt:"2025-10-03T00:00:00Z"},{id:"q102-1",logic:"Q102",symbol:"AVAX",side:"LONG",quantity:9,entry:32,mark:33.5,gross:0.25,openedAt:"2025-10-04T00:00:00Z"}],events:["V4 BTC 利確 / Gross解放"]},
{timestamp:"2025-10-06T00:00:00Z",btc:109600,equity:10030,realized:48,positions:[{id:"q102-1",logic:"Q102",symbol:"AVAX",side:"LONG",quantity:9,entry:32,mark:31.8,gross:0.25,openedAt:"2025-10-04T00:00:00Z"}],events:["PENGU SHORT 決済 / Gross解放"]},
{timestamp:"2025-10-07T00:00:00Z",btc:113000,equity:10140,realized:130,positions:[],events:["Q102 AVAX 利確 / 全建玉解放"]}
]};
const fmt=(n:number)=>n.toLocaleString("ja-JP",{maximumFractionDigits:2});
const fmtOpt=(v:number|null|undefined)=>v===null||v===undefined?"—":fmt(v);
function saveFile(name:string,body:string,type:string){const u=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
export default function BTVerification(){
const [replay,setReplay]=useState<Replay>(DEMO),[cursor,setCursor]=useState(0),[running,setRunning]=useState(false),[speed,setSpeed]=useState(1),[selected,setSelected]=useState<string|null>(null),[error,setError]=useState("");
const [selectedEvent,setSelectedEvent]=useState("");
const [runName,setRunName]=useState("BT-"+new Date().toISOString().slice(0,10)),[savedRuns,setSavedRuns]=useState<SavedRun[]>([]),[savedNotice,setSavedNotice]=useState("");
const [logicFilter,setLogicFilter]=useState<string[]>(["V4","V12","PENGU","V52","Q102","HYPE","FET","IDLE"]),[symbolFilter,setSymbolFilter]=useState<string[]>(["BTC","ETH","SOL","DOGE","AVAX","PENGU","FET","HYPE","NEAR","AMZN"]);
useEffect(()=>{if(!running)return;const t=setInterval(()=>setCursor(i=>Math.min(i+Math.max(1,Math.floor(speed*replay.frames.length/1200)),replay.frames.length-1)),Math.max(60,800/speed));return()=>clearInterval(t)},[running,speed,replay.frames.length]);
useEffect(()=>{listRuns().then(setSavedRuns).catch(()=>setSavedNotice("保存ライブラリを利用できません"))},[]);
useEffect(()=>{if(cursor===replay.frames.length-1)setRunning(false)},[cursor,replay.frames.length]);
const frame=replay.frames[cursor];const positions=frame.positions.filter(p=>logicFilter.includes(p.logic)&&symbolFilter.includes(p.symbol));
const gross=grossForFrame(frame),crypto=gross.crypto,stocks=gross.stock,total=gross.total;
const recentEvents=replay.frames.slice(0,cursor+1).flatMap((f,i)=>f.events.map(event=>({index:i,timestamp:(event.length>=20 && event.charAt(4)==="-" && event.charAt(10)==="T")?event.slice(0,20):f.timestamp,event}))).slice(-35).reverse();
const card="rounded-xl border border-cyan-800 bg-[#10243b] p-4";
async function upload(e:React.ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];if(!file)return;try{if(file.size>10000000)throw Error("ファイルが10MBを超えています");const v=JSON.parse(await file.text()) as Replay;if(!validateReplay(v))throw Error("BTリプレイ形式が不正です");setReplay({...v,mode:"EXTERNAL"});setLogicFilter(Array.from(new Set(v.frames.flatMap(f=>f.positions.map(p=>p.logic)))));setSymbolFilter(Array.from(new Set(v.frames.flatMap(f=>f.positions.map(p=>p.symbol)))));setCursor(0);setRunning(false);setError("")}catch(err){setError(String(err))}e.target.value=""}
function exportTimeline(){
  const rows:(string|number|null)[][]=[["timestamp","equity","realized","gross_total","gross_crypto","gross_stock","positions_count","unallocated_gross_x","gross_snapshot_source"]];
  for(const f of replay.frames){const g=grossForFrame(f);rows.push([f.timestamp,f.equity,f.realized,g.total,g.crypto,g.stock,f.positions.length,g.unallocated,f.gross?.source??"demo_or_unverified"])}
  saveFile("portfolio_timeline.csv",serializeCsv(rows),"text/csv;charset=utf-8");
}
function exportPositions(){
  const rows:(string|number|null)[][]=[["timestamp","id","logic","symbol","side","quantity","entry","mark","notional","gross_x","gross_at_entry_x","gross_pct_total_limit","opened_at"]];
  for(const f of replay.frames)for(const p of f.positions) rows.push([f.timestamp,p.id,p.logic,p.symbol,p.side,p.quantity,p.entry,p.mark,p.notional??(p.quantity!==null&&p.mark!==null?p.quantity*p.mark:null),p.gross,p.grossAtEntry??null,p.gross!==null?100*p.gross/replay.limits.total:null,p.openedAt]);
  saveFile("positions_timeline.csv",serializeCsv(rows),"text/csv;charset=utf-8");
}
async function exportPackage(){
  try{
    const portfolioRows:(string|number|null)[][]=[["timestamp","equity","realized","gross_total","gross_crypto","gross_stock","positions_count","unallocated_gross","source"]];
    const positionRows:(string|number|null)[][]=[["timestamp","position_id","logic","symbol","side","quantity","entry","mark","notional","current_gross_x","entry_gross_x"]];
    const events:{timestamp:string;description:string}[]=[];
    for(const f of replay.frames){
      const g=grossForFrame(f);
      portfolioRows.push([f.timestamp,f.equity,f.realized,g.total,g.crypto,g.stock,f.positions.length,g.unallocated,f.gross?.source??"demo_or_unverified"]);
      for(const p of f.positions)positionRows.push([f.timestamp,p.id,p.logic,p.symbol,p.side,p.quantity,p.entry,p.mark,p.notional??null,p.gross,p.grossAtEntry??null]);
      for(const e of f.events)events.push({timestamp:f.timestamp,description:e});
    }
    const entries:ZipEntry[]=[
      {name:"replay.json",content:JSON.stringify(replay,null,2)},
      {name:"portfolio_timeline.csv",content:serializeCsv(portfolioRows)},
      {name:"positions_timeline.csv",content:serializeCsv(positionRows)},
      {name:"event_ledger_display.json",content:JSON.stringify(events,null,2)},
      {name:"README.txt",content:"DisDex BT visualization export. NOT independent trading/execution proof. Check source provenance, SHA, fees, funding, risk budgets, order fills and logic pins against canonical engine. Displayed events are not signed exchange fills.\n"}
    ];
    const checks:string[]=[];
    for(const item of entries){
      const hash=await globalThis.crypto.subtle.digest("SHA-256",new TextEncoder().encode(item.content));
      checks.push(Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,"0")).join("")+"  "+item.name);
    }
    entries.push({name:"manifest.json",content:JSON.stringify({
      schema:replay.schema,sourceMode:replay.mode,source:replay.source??null,
      engineSha:replay.engineSha,seed:replay.seed,limits:replay.limits,
      frameCount:replay.frames.length,exportedAt:new Date().toISOString(),
      qualification:"Visualization export; not canonical BT execution proof without source and hash verification."
    },null,2)});
    const mh=await globalThis.crypto.subtle.digest("SHA-256",new TextEncoder().encode(entries[entries.length-1].content));
    checks.push(Array.from(new Uint8Array(mh)).map(x=>x.toString(16).padStart(2,"0")).join("")+"  manifest.json");
    entries.push({name:"checksums.sha256",content:checks.join("\n")+"\n"});
    const bytes=makeZip(entries);
    const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:"application/zip"}));
    const a=document.createElement("a");a.href=url;a.download="BT_EVIDENCE_"+Date.now()+".zip";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    setSavedNotice("検証用ZIPをダウンロードしました");
  }catch(e){setSavedNotice("ZIP出力失敗: "+String(e))}
}
async function saveLibrary(){
  try{await saveRun(runName,replay);setSavedRuns(await listRuns());setSavedNotice("ブラウザー内に保存しました")}catch(e){setSavedNotice("保存失敗: "+String(e))}
}
async function loadLibrary(id:string){
  try{const item=await readRun(id);if(!item||!validateReplay(item))throw Error("データが不正");setReplay({...item,mode:item.mode==="DEMO"?"DEMO":"EXTERNAL"});setCursor(0);setRunning(false);setLogicFilter(Array.from(new Set(item.frames.flatMap(f=>f.positions.map(p=>p.logic)))));setSymbolFilter(Array.from(new Set(item.frames.flatMap(f=>f.positions.map(p=>p.symbol)))));setSavedNotice("保存済みデータを再読込しました")}catch(e){setSavedNotice("再読込失敗: "+String(e))}
}
async function downloadLibrary(id:string){
  try{
    const item=await readRun(id);
    if(!item||!validateReplay(item))throw Error("保存内容が不正です");
    saveFile("saved_bt_"+id+".json",JSON.stringify(item,null,2),"application/json");
    setSavedNotice("保存済みBTをダウンロードしました");
  }catch(e){setSavedNotice("ダウンロード失敗: "+String(e))}
}
async function removeLibrary(id:string){
  try{await deleteRun(id);setSavedRuns(await listRuns());setSavedNotice("保存データを削除しました")}catch(e){setSavedNotice("削除失敗: "+String(e))}
}
return <div className="min-h-screen space-y-4 rounded-2xl bg-[#071321] p-5 text-slate-100"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold">BT検証 / 時点同期ポートフォリオ</h1><p className="text-slate-400">BTC代表チャート・建玉・Gross・資産推移・保存/再読込</p></div><strong className="rounded-lg bg-amber-900 px-3 py-2 text-amber-200">{replay.mode==="DEMO"?"サンプル再生・正規BT未接続":"外部データ表示・検証未実施"}</strong></header>
<div className={card}><div className="flex flex-wrap items-center gap-3"><button className="rounded-lg bg-teal-700 px-4 py-2" onClick={()=>setRunning(x=>!x)}>{running?"一時停止":"▶ BT再生"}</button><button className="rounded-lg bg-slate-700 px-4 py-2" onClick={()=>{setRunning(false);setCursor(0)}}>リセット</button><select value={speed} onChange={e=>setSpeed(Number(e.target.value))} className="rounded-lg bg-slate-800 p-2"><option value={1}>1x</option><option value={5}>5x</option><option value={20}>20x</option></select><span>{frame.timestamp.replace("T"," ").replace("Z"," UTC")}</span></div><input className="mt-4 w-full accent-cyan-400" aria-label="BT再生位置" type="range" min={0} max={replay.frames.length-1} value={cursor} onChange={e=>{setRunning(false);setCursor(Number(e.target.value))}}/></div>
<div className="grid gap-3 md:grid-cols-4">{[["評価資産",fmt(frame.equity)],["確定損益",fmt(frame.realized)],["保有建玉数",String(frame.positions.length)],["Gross合計",total.toFixed(2)+"x"]].map(x=><div key={x[0]} className={card}><p className="text-sm text-slate-400">{x[0]}</p><b className="text-2xl">{x[1]}</b></div>)}</div>
<div className="grid gap-4 xl:grid-cols-2"><GrossAllocationPanel frame={frame} limits={replay.limits} unverifiedCap={replay.source?.grossCapEvidence==="USER_SUPPLIED_NOT_VERIFIED"} onSelect={setSelected} selected={selected}/>
<section className={card}><h2 className="mb-4 text-xl font-bold">BTC代表チャート / 資産推移</h2>{(replay.btcCandles?.length??0)>0?<BtcCandlestickChart replay={replay} cursor={cursor} onEventSelect={(at,label)=>{setRunning(false);setCursor(at);setSelectedEvent(label)}}/>:replay.frames.every(f=>f.btc!==null)?<svg viewBox="0 0 600 210" className="w-full rounded-lg bg-[#081524]" role="img" aria-label="BTC価格と発火時刻">{replay.frames.map((f,i)=>i>0?<line key={i} x1={20+(i-1)*550/(replay.frames.length-1)} y1={180-((replay.frames[i-1].btc??0)-100000)/100} x2={20+i*550/(replay.frames.length-1)} y2={180-((f.btc??0)-100000)/100} stroke={(f.btc??0)>=(replay.frames[i-1].btc??0)?"#2dd4bf":"#fb7185"} strokeWidth="4" opacity={i<=cursor?1:0.25}/>:null)}{replay.frames.slice(0,cursor+1).map((f,i)=>f.events.length>0?<circle key={i} cx={20+i*550/(replay.frames.length-1)} cy={180-((f.btc??0)-100000)/100} r="6" fill="#fbbf24"/>:null)}<text x="15" y="200" fontSize="12" fill="#cbd5e1">黄点：取引イベント</text></svg>:<p className="p-4 text-amber-300">BTC時系列未収録。実データを推測して描画しません。</p>}<h3 className="my-2 font-bold">エクイティカーブ</h3><EquityTimelineChart frames={replay.frames} cursor={cursor}/><p className="mt-2 text-sm">最新イベント：{frame.events.join(" / ")||"なし"}</p>{frame.events.length>0&&<p className="mt-2 rounded-lg border border-cyan-700 p-2 text-sm">前回スナップショット→現時点のTotal Gross：{cursor>0?grossForFrame(replay.frames[cursor-1]).total.toFixed(2):"0.00"}x → {total.toFixed(2)}x ／ 建玉数：{cursor>0?replay.frames[cursor-1].positions.length:0} → {frame.positions.length}（厳密な注文前後ではありません）</p>}</section></div>
<section className={card}><h2 className="mb-3 text-xl font-bold">現在のポートフォリオ（時点同期）</h2><div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm"><thead><tr>{["ロジック","銘柄","売買","数量","取得価格","現在価格","建玉金額","Gross","Total割合","含み損益"].map(n=><th key={n} className="border-b border-slate-600 p-2">{n}</th>)}</tr></thead><tbody>{positions.map(p=><tr key={p.id} onClick={()=>setSelected(p.id)} className={selected===p.id?"cursor-pointer bg-slate-700":"cursor-pointer hover:bg-slate-800"}>{[p.logic,p.symbol,p.side,p.quantity,fmt(p.entry),fmtOpt(p.mark),p.quantity!==null&&p.mark!==null?fmt(p.quantity*p.mark):"—",p.gross!==null?p.gross.toFixed(2)+"x":"未算定",p.gross!==null?(100*p.gross/replay.limits.total).toFixed(1)+"%":"—",p.quantity!==null&&p.mark!==null?fmt((p.mark-p.entry)*p.quantity*(p.side==="LONG"?1:-1)):"—"].map((v,i)=><td key={i} className="border-b border-slate-800 p-2">{v}</td>)}</tr>)}</tbody></table></div>{positions.length===0&&<p className="p-3 text-slate-400">保有建玉なし</p>}{positions.find(p=>p.id===selected)&&<p className="mt-3 text-cyan-300">選択建玉：{positions.find(p=>p.id===selected)?.logic} / {positions.find(p=>p.id===selected)?.symbol}</p>}</section>
<section className={card}><h2 className="mb-2 text-lg font-bold">取引イベント履歴（クリックで該当時点へ移動）</h2><p className="mb-2 text-sm text-slate-400">ENTRY / EXIT / BLOCK / RISKイベントを時刻順に表示。モデル取引であり、本番約定記録ではありません。</p><div className="max-h-56 space-y-1 overflow-y-auto">{recentEvents.map((row,i)=><button key={row.index+"-"+i} onClick={()=>{setRunning(false);setCursor(row.index);setSelectedEvent(row.event)}} className="flex w-full flex-wrap justify-between gap-2 rounded-lg border border-slate-700 p-2 text-left text-sm hover:bg-slate-800"><span className="text-cyan-300">{row.timestamp}</span><span className={row.event.includes("BLOCK")?"text-amber-300":"text-slate-200"}>{row.event}</span></button>)}</div>{selectedEvent&&<p className="mt-3 rounded-lg border border-cyan-500/40 p-3 text-sm">選択イベント：{selectedEvent}</p>}</section>
<section className={card}><h2 className="mb-2 text-lg font-bold">表示フィルター（プルダウン追加・削除）</h2><div className="grid gap-3 md:grid-cols-2">{([["ロジック",["V4","V12","PENGU","V52","Q102","HYPE","FET","IDLE"],logicFilter,setLogicFilter],["通貨",["BTC","ETH","SOL","DOGE","AVAX","PENGU","FET","HYPE","NEAR","AMZN"],symbolFilter,setSymbolFilter]] as const).map(([label,all,chosen,setter])=><div key={label}><p>{label}</p><select className="w-full rounded bg-slate-800 p-2" value="" onChange={e=>{if(e.target.value)(setter as (x:string[])=>void)(Array.from(new Set([...chosen,e.target.value])))}}><option value="">＋追加</option>{all.filter(x=>!chosen.includes(x)).map(x=><option key={x}>{x}</option>)}</select><div className="flex flex-wrap gap-2 py-2">{chosen.map(x=><button className="rounded border border-cyan-600 px-2 py-1" key={x} onClick={()=>(setter as (x:string[])=>void)(chosen.filter(y=>x!==y))}>{x} ×</button>)}</div></div>)}</div></section>
<section className={card}><h2 className="mb-2 text-lg font-bold">保存・ダウンロード・Codex/GPT分析</h2><p className="mb-3 text-sm text-slate-400">外部データには正規BTエンジンの署名・SHA照合が必要です。このページのサンプル値はBT実績ではありません。</p><div className="mb-3 flex flex-wrap items-center gap-2"><input aria-label="保存名" value={runName} onChange={e=>setRunName(e.target.value)} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2"/><button onClick={saveLibrary} className="rounded-lg bg-teal-800 px-4 py-2">保存ライブラリに登録</button><span className="text-sm text-cyan-200">{savedNotice}</span></div><div className="flex flex-wrap gap-2"><button className="rounded-lg bg-teal-700 px-4 py-2" onClick={()=>saveFile("bt_replay.json",JSON.stringify(replay,null,2),"application/json")}>JSONダウンロード</button><button className="rounded-lg bg-slate-700 px-4 py-2" onClick={exportTimeline}>資産/Gross時系列 CSV</button><button className="rounded-lg bg-slate-700 px-4 py-2" onClick={exportPositions}>建玉時系列 CSV</button><button className="rounded-lg bg-violet-800 px-4 py-2" onClick={exportPackage}>GPT / Codex用 ZIPエクスポート</button><label className="cursor-pointer rounded-lg border border-cyan-600 px-4 py-2">JSON再読込 <input className="hidden" type="file" accept=".json" onChange={upload}/></label></div>{error&&<p className="mt-2 text-rose-300">{error}</p>}<h3 className="mt-4 mb-2 font-bold">保存済みのBT再生</h3><p className="text-xs text-slate-400">このブラウザー内のみ保存。PC変更やブラウザーデータ削除に備えてJSONをダウンロードしてください。</p><div className="space-y-2">{savedRuns.map(item=><div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 py-2"><span>{item.name} / {item.frames}時点 / {item.createdAt}</span><div className="flex gap-2"><button className="rounded bg-cyan-800 px-3 py-1" onClick={()=>loadLibrary(item.id)}>再読込</button><button className="rounded bg-slate-700 px-3 py-1" onClick={()=>downloadLibrary(item.id)}>JSONをDL</button><button className="rounded bg-rose-950 px-3 py-1" onClick={()=>removeLibrary(item.id)}>削除</button></div></div>)}</div></section><p className="text-xs text-slate-400">Read-only / DEMO。LIVE注文・Runner・STOP・Kill Switchとは非接続。画面のGrossはスナップショット値であり、正式なBT計算は行いません。</p></div>
}
