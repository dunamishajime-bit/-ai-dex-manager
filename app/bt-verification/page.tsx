 "use client";
import {useEffect,useMemo,useState} from "react";
import type {Replay,Position} from "@/lib/bt-verification/replay";
import {isStock,validateReplay,grossForFrame,serializeCsv} from "@/lib/bt-verification/replay";
import {saveRun,listRuns,readRun,deleteRun,type SavedRun} from "@/lib/bt-verification/storage";
import {makeZip,type ZipEntry} from "@/lib/bt-verification/zip-store";
import {BtcCandlestickChart} from "@/components/bt-verification/BtcCandlestickChart";
import {EquityTimelineChart} from "@/components/bt-verification/EquityTimelineChart";
import {GrossAllocationPanel} from "@/components/bt-verification/GrossAllocationPanel";
import {BTWorkspaceShell,type BTWorkspaceTab} from "@/components/bt-verification/BTWorkspaceShell";
import {createPreviewReplay,type DemoScenario} from "@/lib/bt-verification/demo";
import {Activity,Archive,BarChart3,CalendarDays,Clock3,Download,FileText,Pause,Play,RotateCcw,Save,Settings2,ShieldAlert,Upload} from "lucide-react";
const DEMO=createPreviewReplay(123456,"trend");
const SHOW_SERVER_ARCHIVE=true;
const fmt=(n:number)=>n.toLocaleString("ja-JP",{maximumFractionDigits:2});
const fmtOpt=(v:number|null|undefined)=>v===null||v===undefined?"—":fmt(v);
function saveFile(name:string,body:string,type:string){const u=URL.createObjectURL(new Blob([body],{type}));const a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
export default function BTVerification(){
const [tab,setTab]=useState<BTWorkspaceTab>("config");
const [previewMode,setPreviewMode]=useState<"synthetic"|"historical">("synthetic");
const [scenario,setScenario]=useState<DemoScenario>("trend");
const [previewSeed,setPreviewSeed]=useState(123456);

const [replay,setReplay]=useState<Replay>(DEMO),[cursor,setCursor]=useState(0),[running,setRunning]=useState(false),[speed,setSpeed]=useState(1),[selected,setSelected]=useState<string|null>(null),[error,setError]=useState("");
const [selectedEvent,setSelectedEvent]=useState("");
const [eventFilter,setEventFilter]=useState<"TRADES"|"RISK"|"FUNDING"|"ALL">("TRADES");
type ServerRun={id:string;name:string;createdAt:string;frames:number;mode:string;bytes:number;sha256:string;sourceKind:string};
const [serverRuns,setServerRuns]=useState<ServerRun[]>([]);
const [serverNotice,setServerNotice]=useState("");
const [runName,setRunName]=useState("BT-"+new Date().toISOString().slice(0,10)),[savedRuns,setSavedRuns]=useState<SavedRun[]>([]),[savedNotice,setSavedNotice]=useState("");
const [logicFilter,setLogicFilter]=useState<string[]>(["DEMO_V4","DEMO_PENGU","DEMO_Q102"]),[symbolFilter,setSymbolFilter]=useState<string[]>(["BTC"]);
useEffect(()=>{
 if(!running)return;
 // DEMO: show intermediate 5-minute price ticks instead of skipping whole candles.
 // Accelerated modes only change presentation cadence, never strategy evaluation.
 const demo=replay.mode==="DEMO";
 const delay=demo?(speed===1?90:speed===5?58:40):Math.max(60,800/speed);
 const step=demo?(speed===20?3:speed===5?2:1):
   Math.max(1,Math.floor(speed*replay.frames.length/1200));
 const t=setInterval(()=>setCursor(i=>Math.min(i+step,replay.frames.length-1)),delay);
 return()=>clearInterval(t);
},[running,speed,replay.mode,replay.frames.length]);
useEffect(()=>{listRuns().then(setSavedRuns).catch(()=>setSavedNotice("保存ライブラリを利用できません"))},[]);
useEffect(()=>{if(cursor===replay.frames.length-1)setRunning(false)},[cursor,replay.frames.length]);
const catalogs=useMemo(()=>{
  // Only expose symbols/strategies present in the actual selected replay.
  // A synthetic BTC demo must never advertise real exchange symbols as simulated.
  const allLogics=new Set<string>();
  const allSymbols=new Set<string>();
  for(const item of replay.strategyCatalog??[]) allLogics.add(item.logic);
  for(const f of replay.frames)for(const p of f.positions){allLogics.add(p.logic);allSymbols.add(p.symbol)}
  return {logics:[...allLogics].sort(),symbols:[...allSymbols].sort()};
},[replay]);
const frame=replay.frames[cursor];const positions=frame.positions.filter(p=>logicFilter.includes(p.logic)&&symbolFilter.includes(p.symbol));
const gross=grossForFrame(frame),crypto=gross.crypto,stocks=gross.stock,total=gross.total;
const recentEvents=replay.frames.slice(0,cursor+1).flatMap((f,i)=>f.events.map(event=>({index:i,timestamp:(event.length>=20 && event.charAt(4)==="-" && event.charAt(10)==="T")?event.slice(0,20):f.timestamp,event})))
 .filter(row=>eventFilter==="ALL"||
   (eventFilter==="FUNDING"&&row.event.includes(" FUNDING "))||
   (eventFilter==="RISK"&&(row.event.includes(" BLOCK ")||row.event.includes(" RISK ")))||
   (eventFilter==="TRADES"&&([" ENTRY "," EXIT "," PARTIAL "," 発火"," エントリー"," 利確"," 決済"," 損切"].some(k=>row.event.includes(k)))))
 .slice(-35).reverse();
const card="rounded-[16px] border border-[#2b445b] bg-[linear-gradient(145deg,#15283e_0%,#0f1f32_100%)] shadow-[0_6px_28px_rgba(1,8,20,.16)]";
const metric="rounded-[14px] border border-[#2c4559] bg-[linear-gradient(180deg,#152a3d,#101f31)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,.025)]";
const inputCls="w-full min-w-0 rounded-[9px] border border-[#344e64] bg-[#0b1a2b] px-3 py-2.5 text-[13px] font-medium text-slate-100 outline-none focus:border-cyan-400";
const chosenCount=logicFilter.length+"ロジック / "+symbolFilter.length+"通貨";
const initialEquity=replay.frames[0]?.equity??1;
const equityChange=frame.equity-initialEquity;
const changePct=initialEquity?equityChange/initialEquity*100:0;
let peak=-Infinity,maxDrawdown=0;
for(let i=0;i<=cursor;i++){const value=replay.frames[i].equity;peak=Math.max(peak,value);if(peak>0)maxDrawdown=Math.min(maxDrawdown,100*(value/peak-1))}
const isResearch=replay.mode==="EXTERNAL";
const sourceLabel=isResearch?"研究データ・未認証":"模擬再生・デモ";
const signalState=frame.demoSignals??[];
const activeCandlestick=frame.formingBtcCandle;
const currentCrossings=signalState.filter(x=>x.crossed);
const firedCount=replay.mode==="DEMO"?replay.frames.slice(0,cursor+1).reduce(
  (sum,f)=>sum+(f.demoSignals?.filter(x=>x.fired).length??0),0):null;

const titleCase=(s:string)=>s.replace("T"," ").replace("Z"," UTC");
function prepareDemo(){
  const demo=createPreviewReplay(previewSeed,scenario);
  setReplay(demo);setCursor(0);setRunning(false);setError("");
  setLogicFilter([...new Set(demo.frames.flatMap(f=>f.positions.map(p=>p.logic)))]);
  setSymbolFilter([...new Set(demo.frames.flatMap(f=>f.positions.map(p=>p.symbol)))]);
  return demo;
}
function startPlayback(){
  if(previewMode==="historical"&&!isResearch){setError("実データはレポート画面からJSONを読み込んでください。新規BT計算は未接続です。");setTab("report");return}
  if(previewMode==="synthetic")prepareDemo();
  setCursor(0);setSelectedEvent("");setRunning(true);setTab("playback");
}
function switchTab(next:BTWorkspaceTab){setTab(next);setRunning(false)}
function selector(label:string,all:string[],chosen:string[],setter:(x:string[])=>void){
 return <div className="min-w-0">
   <div className="mb-2 flex items-center justify-between"><label className="text-[13px] font-semibold text-slate-200">{label}</label><span className="text-[11px] text-[#7894ad]">{chosen.length} 選択</span></div>
   <div className="flex min-h-[56px] flex-wrap items-center gap-1.5 rounded-xl border border-[#334d63] bg-[#0c1a2d] p-2">
    {chosen.map(value=><button key={value} type="button" className="rounded-md border border-[#376280] bg-[#213952] px-2.5 py-1.5 text-[11px] font-semibold text-[#daebfb] hover:border-cyan-400" onClick={()=>setter(chosen.filter(x=>x!==value))}>{value} <span className="pl-1 text-cyan-400">×</span></button>)}
    <select aria-label={label+"を追加"} className="max-w-full min-w-[84px] flex-1 bg-transparent px-1 text-[11px] text-cyan-200 outline-none" value="" onChange={e=>{if(e.target.value)setter([...chosen,e.target.value])}}>
      <option value="">＋ 追加</option>
      {all.filter(x=>!chosen.includes(x)).map(value=><option key={value} value={value}>{value}</option>)}
    </select>
   </div>
 </div>
}

async function upload(e:React.ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];if(!file)return;try{if(file.size>60_000_000)throw Error("ファイルが60MBを超えています");const v=JSON.parse(await file.text()) as Replay;if(!validateReplay(v))throw Error("BTリプレイ形式が不正です");setReplay({...v,mode:"EXTERNAL"});setPreviewMode("historical");setTab("playback");setLogicFilter(Array.from(new Set(v.frames.flatMap(f=>f.positions.map(p=>p.logic)))));setSymbolFilter(Array.from(new Set(v.frames.flatMap(f=>f.positions.map(p=>p.symbol)))));setCursor(0);setRunning(false);setError("")}catch(err){setError(String(err))}e.target.value=""}
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
function strategyReportCsv(){
  const rows:(string|number|null)[][]=[["logic","symbol","model_trades","closed","wins","win_rate_pct","model_net_pnl_jpy","max_single_loss_jpy"]];
  for(const r of replay.strategyStats??[]) rows.push([r.logic,r.symbol,r.tradeCount,r.closedCount,r.wins,r.winRatePct,r.netPnlJpy,r.maxLossJpy]);
  return serializeCsv(rows);
}
function exportStrategyStats(){
  if(!(replay.strategyStats?.length)){setSavedNotice("ロジック別集計がないためCSVは出力できません");return}
  saveFile("logic_symbol_model_performance.csv",strategyReportCsv(),"text/csv;charset=utf-8");
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
      {name:"logic_symbol_model_performance.csv",content:strategyReportCsv()},
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
async function refreshServerRuns(){
  try{
    const res=await fetch("/api/bt-verification/runs",{cache:"no-store",credentials:"same-origin"});
    const json:unknown=await res.json();
    if(!res.ok)throw Error("サーバー保管利用不可 / "+res.status);
    const obj=json as {items?:ServerRun[]};
    setServerRuns(Array.isArray(obj.items)?obj.items:[]);
    setServerNotice("サーバーに保存された結果を取得しました");
  }catch(e){setServerNotice(String(e))}
}
async function saveServerRun(){
  try{
    const res=await fetch("/api/bt-verification/runs",{method:"POST",credentials:"same-origin",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({name:runName,replay})});
    const raw:unknown=await res.json();
    if(!res.ok)throw Error("保存不可: "+res.status+" "+JSON.stringify(raw));
    await refreshServerRuns();
    setServerNotice("認証済みサーバーへ保存しました");
  }catch(e){setServerNotice(String(e))}
}
async function serverGet(id:string):Promise<Replay>{
  const res=await fetch("/api/bt-verification/runs/"+encodeURIComponent(id),
    {cache:"no-store",credentials:"same-origin"});
  if(!res.ok)throw Error("サーバー読込失敗: "+res.status);
  const raw:unknown=await res.json();
  if(!raw||typeof raw!=="object")throw Error("サーバーデータ不正");
  const data=(raw as {data:unknown}).data;
  if(!validateReplay(data))throw Error("保存内容のスキーマ不正");
  return data;
}
async function loadServerRun(id:string){
  try{
    const item=await serverGet(id);
    setReplay({...item,mode:item.mode==="DEMO"?"DEMO":"EXTERNAL"});setPreviewMode(item.mode==="DEMO"?"synthetic":"historical");setTab("playback");
    setCursor(0);setRunning(false);
    setLogicFilter(Array.from(new Set(item.frames.flatMap(f=>f.positions.map(p=>p.logic)))));
    setSymbolFilter(Array.from(new Set(item.frames.flatMap(f=>f.positions.map(p=>p.symbol)))));
    setServerNotice("サーバー保存のBTを再読込しました");
  }catch(e){setServerNotice(String(e))}
}
async function downloadServerRun(id:string){
  try{const item=await serverGet(id);saveFile("server_bt_"+id+".json",JSON.stringify(item,null,2),"application/json");setServerNotice("サーバー保存BTのJSONをダウンロードしました")}
  catch(e){setServerNotice(String(e))}
}
async function deleteServerRun(id:string){
  if(!window.confirm("サーバー保存のBTを削除しますか？"))return;
  try{
    const res=await fetch("/api/bt-verification/runs/"+encodeURIComponent(id),
      {method:"DELETE",credentials:"same-origin"});
    if(!res.ok)throw Error("サーバー削除失敗: "+res.status);
    await refreshServerRuns();setServerNotice("サーバー保存BTを削除しました");
  }catch(e){setServerNotice(String(e))}
}
async function saveLibrary(){
  try{await saveRun(runName,replay);setSavedRuns(await listRuns());setSavedNotice("ブラウザー内に保存しました")}catch(e){setSavedNotice("保存失敗: "+String(e))}
}
async function loadLibrary(id:string){
  try{const item=await readRun(id);if(!item||!validateReplay(item))throw Error("データが不正");setReplay({...item,mode:item.mode==="DEMO"?"DEMO":"EXTERNAL"});setPreviewMode(item.mode==="DEMO"?"synthetic":"historical");setTab("playback");setCursor(0);setRunning(false);setLogicFilter(Array.from(new Set(item.frames.flatMap(f=>f.positions.map(p=>p.logic)))));setSymbolFilter(Array.from(new Set(item.frames.flatMap(f=>f.positions.map(p=>p.symbol)))));setSavedNotice("保存済みデータを再読込しました")}catch(e){setSavedNotice("再読込失敗: "+String(e))}
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
return <BTWorkspaceShell activeTab={tab} onTabChange={switchTab} sourceStatus={sourceLabel}>
  {tab==="config"&&<div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.22fr)_minmax(0,.96fr)]">
    <section className={card+" overflow-hidden"}>
      <div className="flex items-center gap-3 border-b border-[#2b445a] px-5 py-4">
        <Settings2 className="h-5 w-5 text-cyan-300"/>
        <div className="min-w-0"><h2 className="text-[17px] font-bold text-white">検証条件</h2>
          <p className="mt-1 text-[11px] text-[#8da5be]">ロジック・銘柄・再生モードを選択して視覚的に検証します。</p></div>
      </div>
      <div className="space-y-5 p-5">
        <div className="grid gap-3 lg:grid-cols-[164px_minmax(0,1fr)]">
          <div><p className="text-[13px] font-bold text-slate-100">ロジック選択 <span className="ml-1 rounded bg-rose-700/50 px-1.5 py-0.5 text-[10px] text-rose-100">必須</span></p><p className="mt-1 text-[11px] leading-5 text-[#829bb4]">一覧から追加・削除できます。</p></div>
          {selector("検証対象ロジック",catalogs.logics,logicFilter,setLogicFilter)}
        </div>
        <div className="grid gap-3 border-t border-[#223a50] pt-4 lg:grid-cols-[164px_minmax(0,1fr)]">
          <div><p className="text-[13px] font-bold text-slate-100">通貨選択 <span className="ml-1 rounded bg-rose-700/50 px-1.5 py-0.5 text-[10px] text-rose-100">必須</span></p><p className="mt-1 text-[11px] leading-5 text-[#829bb4]">時点同期の表示対象です。</p></div>
          {selector("対象通貨・株式",catalogs.symbols,symbolFilter,setSymbolFilter)}
        </div>
        <div className="grid gap-3 border-t border-[#223a50] pt-4 lg:grid-cols-[164px_minmax(0,1fr)]">
          <div><p className="text-[13px] font-bold text-slate-100">検証モード</p><p className="mt-1 text-[11px] leading-5 text-[#829bb4]">研究データの再生、または合成相場のプレビュー。</p></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={()=>setPreviewMode("historical")}
              className={"flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-[13px] font-semibold "+(previewMode==="historical"?"border-cyan-400 bg-[#11434a] text-cyan-100":"border-[#37516a] bg-[#102139] text-[#92abc3]")}>
              <Archive className="h-4 w-4"/> 実データを読込・再生
            </button>
            <button type="button" onClick={()=>setPreviewMode("synthetic")}
              className={"flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-[13px] font-semibold "+(previewMode==="synthetic"?"border-cyan-400 bg-[#11434a] text-cyan-100":"border-[#37516a] bg-[#102139] text-[#92abc3]")}>
              <Activity className="h-4 w-4"/> 模擬チャート再生
            </button>
            <p className="text-[11px] leading-5 text-[#8ca8bb] sm:col-span-2">実データは研究BTのJSON読込後に再生できます。新規BT計算は未接続です。</p>
          </div>
        </div>
        <div className="grid gap-3 border-t border-[#223a50] pt-4 lg:grid-cols-[164px_minmax(0,1fr)]">
          <div><p className="text-[13px] font-bold text-slate-100">期間</p><p className="mt-1 text-[11px] leading-5 text-[#829bb4]">読み込んだデータの記録期間。</p></div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#698daa]"/><input aria-label="データ開始日" type="date" value={replay.frames[0].timestamp.slice(0,10)} readOnly className={inputCls+" pl-9 opacity-80"}/></div>
            <span className="text-slate-400">〜</span>
            <div className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#698daa]"/><input aria-label="データ終了日" type="date" value={replay.frames[replay.frames.length-1].timestamp.slice(0,10)} readOnly className={inputCls+" pl-9 opacity-80"}/></div>
          </div>
        </div>
        <div className="grid gap-3 border-t border-[#223a50] pt-4 lg:grid-cols-[164px_minmax(0,1fr)]">
          <div><p className="text-[13px] font-bold text-slate-100">シナリオ（模擬時）</p><p className="mt-1 text-[11px] leading-5 text-[#829bb4]">チャートの動きを切り替えられます。</p></div>
          <div className="flex flex-wrap gap-2">{([
            ["trend","↗ 上昇相場"],["range","↔ レンジ"],["down","↘ 下落相場"],["volatile","⌁ 高変動"]
          ] as const).map(([id,label])=><button type="button" key={id} disabled={previewMode!=="synthetic"}
            onClick={()=>setScenario(id)}
            className={"rounded-lg border px-3 py-2 text-[12px] font-semibold disabled:opacity-40 "+(scenario===id?"border-cyan-400 bg-[#144e52] text-cyan-100":"border-[#3a536a] bg-[#112238] text-[#95adc6] hover:border-cyan-600")}>{label}{scenario===id?" ✓":""}</button>)}</div>
        </div>
        <div className="grid gap-3 border-t border-[#223a50] pt-4 sm:grid-cols-3">
          <label className="text-xs font-medium text-[#95abc1]">シード値
            <input aria-label="模擬シード値" type="number" min={0} max={2147483647} value={previewSeed} disabled={previewMode!=="synthetic"}
              onChange={e=>setPreviewSeed(Math.max(0,Math.min(2147483647,Number(e.target.value)||0)))} className={inputCls+" mt-2 disabled:opacity-60"}/></label>
          <label className="text-xs font-medium text-[#95abc1]">再生速度
            <select value={speed} onChange={e=>setSpeed(Number(e.target.value))} className={inputCls+" mt-2"}><option value={1}>1x</option><option value={5}>5x</option><option value={20}>20x</option></select></label>
          <div className="text-xs font-medium text-[#95abc1]">初期資金（データ記録値）
            <div className={inputCls+" mt-2 text-right opacity-80"}>¥ {fmt(initialEquity)}</div></div>
        </div>
        <div className="rounded-xl border border-amber-700/30 bg-amber-950/10 p-3 text-[11px] leading-5 text-amber-100/90">
          <ShieldAlert className="mr-1 inline h-4 w-4"/> この画面のロジック・銘柄選択は再生の<strong>表示フィルター</strong>です。選択を変えても過去BTの取引結果・Grossは再計算されません。模擬データは実際の相場や運用成績ではありません。
        </div>
        <div className="grid gap-2 border-t border-[#2b445b] pt-4 sm:grid-cols-3">
          <button type="button" onClick={()=>{prepareDemo();setTab("playback")}} disabled={previewMode!=="synthetic"} className="flex items-center justify-center gap-2 rounded-xl border border-[#3685bc] bg-[#12364d] px-3 py-3 text-xs font-bold text-cyan-100 hover:border-cyan-400 disabled:opacity-50"><Activity className="h-4 w-4"/>模擬チャート生成</button>
          <button type="button" onClick={startPlayback} disabled={previewMode==="historical"&&!isResearch} className="flex items-center justify-center gap-2 rounded-xl border border-[#3cf3dd]/70 bg-[linear-gradient(110deg,#078e95,#12b8a5)] px-3 py-3 text-sm font-bold text-white shadow-[0_8px_28px_rgba(0,184,169,.2)] hover:brightness-110 disabled:opacity-50"><Play className="h-4 w-4 fill-current"/> BT再生を開始</button>
          <button type="button" onClick={()=>setTab("library")} className="flex items-center justify-center gap-2 rounded-xl border border-[#46627d] bg-[#1a3047] px-3 py-3 text-xs font-bold text-slate-100 hover:border-cyan-500"><Save className="h-4 w-4"/>設定・再生を保存</button>
        </div>
        {error&&<div className="rounded-lg border border-rose-500/50 p-3 text-xs text-rose-200">{error}</div>}
      </div>
    </section>
    <div className="space-y-4">
      <section className={card+" p-4"}>
        <div className="mb-3 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-[15px] font-bold text-white"><Activity className="h-5 w-5 text-cyan-300"/>BTC代表チャートプレビュー</h2><span className="rounded-full border border-[#3c6582] bg-[#18364e] px-2 py-1 text-[10px] text-[#b1d7e8]">{replay.mode==="DEMO"?"模擬データ":"研究データ"}</span></div>
        {(replay.btcCandles?.length??0)>0?<BtcCandlestickChart replay={replay} cursor={replay.frames.length-1} onEventSelect={(at,label)=>{setCursor(at);setSelectedEvent(label);setTab("playback")}}/>:
        <div className="rounded-xl border border-dashed border-[#365269] p-8 text-center text-sm text-[#8ea8bf]">BTCローソク足はこのデータに含まれていません。</div>}
        <p className="mt-2 rounded-lg bg-[#172f47] p-2 text-[11px] text-[#96b8d0]">シード値で模擬相場を再現。BTCの代表チャートと各通貨の取引イベントを同じ時間軸に表示します。</p>
      </section>
      <section className={card+" overflow-hidden"}>
        <div className="border-b border-[#2b4356] px-4 py-3"><h2 className="flex items-center gap-2 text-[15px] font-bold text-white"><Archive className="h-4 w-4 text-cyan-300"/>ロジック登録情報</h2><p className="mt-1 text-[11px] text-[#8ca2b9]">この再生データに記録されたロジック。最新LIVEの認証済みバージョンとは限りません。</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[400px] text-left text-[12px]">
          <thead className="bg-[#162b40] text-[#a2b8cf]"><tr>{["ロジック","状態","モデル取引","参照元"].map(x=><th key={x} className="px-3 py-2.5 font-medium">{x}</th>)}</tr></thead>
          <tbody>{(replay.strategyCatalog?.length?replay.strategyCatalog.map(x=>({logic:x.logic,amount:x.trades,ref:x.sourceRuntimeShas[0]??"記録なし"})):catalogs.logics.map(x=>({logic:x,amount:0,ref:"模擬用"}))).map(x=><tr key={x.logic} className="border-t border-[#283f54]"><td className="px-3 py-3 font-bold text-cyan-300">{x.logic}</td><td className="px-3 py-3"><span className="rounded-full bg-amber-900/30 px-2 py-1 text-[10px] text-amber-200">未認証</span></td><td className="px-3 py-3 text-slate-200">{x.amount||"—"}</td><td className="max-w-28 truncate px-3 py-3 font-mono text-[10px] text-[#9aaec2]" title={x.ref}>{x.ref.slice(0,12)}</td></tr>)}</tbody>
        </table></div>
      </section>
    </div>
  </div>}
  {tab==="playback"&&<div className="space-y-4">
    <section className={card+" flex flex-wrap items-center gap-3 px-4 py-3"}>
      <button type="button" onClick={()=>setRunning(x=>!x)} className="flex items-center justify-center gap-2 rounded-lg border border-cyan-400 bg-[#14515b] px-5 py-2.5 text-[13px] font-bold text-white hover:bg-[#16606c]">{running?<><Pause className="h-4 w-4"/>一時停止</>:<><Play className="h-4 w-4"/>再生</>}</button>
      <button type="button" onClick={()=>{setRunning(false);setCursor(0)}} className="flex items-center gap-2 rounded-lg border border-[#3d5870] bg-[#1b2f45] px-4 py-2.5 text-[12px] text-slate-100"><RotateCcw className="h-4 w-4"/>リセット</button>
      <div className="flex items-center gap-2 border-l border-[#355066] pl-3"><span className="text-xs text-[#8ea7be]">速度</span>{[1,5,20].map(n=><button key={n} onClick={()=>setSpeed(n)} className={"rounded-md border px-3 py-2 text-[12px] "+(speed===n?"border-cyan-400 bg-[#124f57] text-cyan-100":"border-[#3c536b] text-slate-300")}>{n}x</button>)}</div>
      <div className="ml-auto flex items-center gap-2 rounded-lg border border-[#35516c] bg-[#0a192b] px-3 py-2 text-[12px] text-[#c7dae9]"><Clock3 className="h-4 w-4 text-cyan-300"/> {titleCase(frame.timestamp)}</div>
      <label className="w-full"><span className="sr-only">BT再生時刻</span><input type="range" min={0} max={replay.frames.length-1} value={cursor} aria-label="BT再生時刻" onChange={e=>{setRunning(false);setCursor(Number(e.target.value))}} className="w-full cursor-pointer accent-cyan-400"/></label>
    </section>
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
      {([
        ["現在残高","¥ "+fmt(frame.equity),(changePct>=0?"+":"")+changePct.toFixed(2)+"%",changePct>=0?"text-emerald-300":"text-rose-300"],
        ["開始からの増減","¥ "+fmt(equityChange),(changePct>=0?"+":"")+changePct.toFixed(2)+"%","text-cyan-200"],
        ["確定損益","¥ "+fmt(frame.realized),"モデル台帳","text-emerald-300"],
        ["最大DD",maxDrawdown.toFixed(2)+"%","再生済み区間","text-rose-300"],
        ["使用中Gross",total.toFixed(2)+"x",((total/replay.limits.total)*100).toFixed(1)+"% / Total上限","text-cyan-100"],
        ["保有建玉",String(frame.positions.length),replay.researchSummary?"研究取引 "+replay.researchSummary.modelFills+"件":"デモ専用","text-[#d8e8f6]"]
      ] as const).map(([label,val,sub,color])=><div key={label} className={metric}><div className="mb-2 text-[11px] font-semibold text-[#8da6bd]">{label}</div><div className={"text-[19px] font-bold tracking-tight sm:text-[22px] "+color}>{val}</div><div className="mt-1 text-[11px] text-[#819cb3]">{sub}</div></div>)}
    </div>
    <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(310px,.85fr)]">
      <section className={card+" min-w-0 p-4"}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-[16px] font-bold text-white"><Activity className="h-5 w-5 text-cyan-300"/>BTC / USDT（代表チャート）</h2><span className="text-[11px] text-[#a7becd]">{replay.mode==="DEMO"?"5分刻みで1時間足が形成・模擬判定":"1時間確定足・研究モデルの発火マーカー"}</span></div>
        {(replay.btcCandles?.length??0)>0?<BtcCandlestickChart replay={replay} cursor={cursor} onEventSelect={(at,label)=>{setRunning(false);setCursor(at);setSelectedEvent(label)}}/>:<div className="rounded-lg border border-dashed border-[#38546b] p-10 text-center text-[#8ea6ba]">確定済BTCローソク足を読み込むと表示されます。</div>}
      </section>
      <div className="min-w-0 space-y-4">
        {replay.mode==="DEMO"&&<section className={card+" overflow-hidden"}>
          <div className="flex items-center justify-between border-b border-[#2c4e61] px-4 py-3">
            <div><h2 className="text-[15px] font-bold text-white">価格連動・模擬発火Gate</h2>
              <p className="mt-1 text-[10px] text-[#8ea9c1]">確定済み1時間足 + 現在の5分価格だけで判定</p></div>
            <div className="rounded-lg border border-[#206879] bg-[#0e3d47] px-2.5 py-1.5 text-right">
              <span className="block text-[10px] text-[#9fbecb]">累計発火</span>
              <span className="font-mono text-[16px] font-bold text-cyan-100">{firedCount}</span>
            </div>
          </div>
          <div className="space-y-2 p-3">{signalState.map(signal=><div key={signal.logic}
            className={"rounded-xl border px-3 py-2.5 transition-colors duration-150 "+(signal.fired?
              "border-emerald-400/55 bg-emerald-800/20":signal.crossed?"border-amber-500/40 bg-amber-900/10":"border-[#29455a] bg-[#0a2133]/80")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold text-[#d4eaf7]">{signal.logic.replace("DEMO_","")}</span>
                <span className={"rounded px-1.5 py-0.5 text-[10px] "+(signal.side==="LONG"?"bg-emerald-900/40 text-emerald-300":"bg-rose-900/40 text-rose-300")}>{signal.side}</span>
              </div>
              <span className={"rounded-md px-2 py-1 text-[10px] font-bold "+(signal.fired?
                "bg-emerald-500/25 text-emerald-200":signal.crossed?"bg-amber-600/20 text-amber-200":"bg-[#21374b] text-[#8ea8bd]")}>
                {signal.fired?"● 発火":signal.crossed?"△ ゲート通過・見送り":"― 未発火"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap justify-between gap-1 font-mono text-[11px]">
              <span className="text-[#8faabe]">基準 {signal.direction==="ABOVE"?">":"<"} {signal.threshold===null?"確定足待ち":fmt(signal.threshold)}</span>
              <span className="text-[#bde7e7]">現在 {fmt(signal.price)}</span>
            </div>
            <div className="mt-1.5 text-[10px] text-[#8ca6b9]">{signal.note}</div>
          </div>)}</div>
          <p className="border-t border-[#29465a] px-3 py-2 text-[10px] leading-5 text-amber-200/90">
            V4・PENGU・Q102を模したデモ専用Gateです。現行本番ロジックの判定条件ではありません。
          </p>
        </section>}
      <section className={card+" min-w-0 overflow-hidden"}>
        <div className="flex items-center justify-between border-b border-[#30485e] px-4 py-3"><h2 className="text-[15px] font-bold text-white">取引イベント（時点同期）</h2><select aria-label="イベント種別" value={eventFilter} onChange={e=>setEventFilter(e.target.value as typeof eventFilter)} className="rounded-md border border-[#426078] bg-[#172d44] px-2 py-1 text-[11px]"><option value="TRADES">売買</option><option value="RISK">リスク</option><option value="FUNDING">Funding</option><option value="ALL">全て</option></select></div>
        <div className="max-h-[415px] min-h-[285px] overflow-y-auto">{recentEvents.length?recentEvents.map((e,i)=><button type="button" key={e.index+"-"+i} onClick={()=>{setRunning(false);setCursor(e.index);setSelectedEvent(e.event)}} className="flex w-full items-start gap-3 border-b border-[#263b50] px-4 py-3 text-left hover:bg-[#1b3349]"><span className={"mt-1 h-2.5 w-2.5 shrink-0 rounded-full "+(e.event.includes("EXIT")?"bg-emerald-400":e.event.includes("PARTIAL")?"bg-violet-400":"bg-cyan-400")}/><span className="min-w-0"><span className="block text-[11px] text-[#87a3bc]">{e.timestamp.slice(5,16).replace("T"," ")}</span><span className="mt-1 block break-all text-[12px] leading-5 text-[#d6e4f1]">{e.event}</span></span></button>):<p className="p-6 text-sm text-[#87a0b9]">この時点までにイベントはありません。</p>}</div>
      </section>
      </div>
    </div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.06fr)_minmax(0,.94fr)]">
      <section className={card+" min-w-0 p-4"}><h2 className="mb-3 flex items-center gap-2 text-[16px] font-bold text-white"><BarChart3 className="h-5 w-5 text-cyan-300"/>エクイティカーブ（資産推移）</h2><EquityTimelineChart frames={replay.frames} cursor={cursor}/></section>
      <GrossAllocationPanel frame={frame} limits={replay.limits} selected={selected} onSelect={setSelected} researchManifestCap={replay.source?.grossCapEvidence==="SOURCE_SUMMARY_MATCHED_RESEARCH_ONLY"} unverifiedCap={replay.source?.grossCapEvidence==="USER_SUPPLIED_NOT_VERIFIED"}/>
    </div>
    <section className={card+" min-w-0 p-4"}>
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-[16px] font-bold text-white">保有建玉ポートフォリオ</h2><span className="rounded-full bg-[#17404a] px-3 py-1 text-[11px] text-cyan-200">{frame.positions.length} 建玉 / Gross {total.toFixed(2)}x</span></div>
      <p className="mb-3 text-[11px] text-[#8ea6bb]">ロジック・通貨の表示フィルターは建玉一覧だけに適用され、Total Grossと口座資産は変わりません。欠損した現在値は推測しません。</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[790px] text-left text-[12px]"><thead className="bg-[#182f45] text-[#9db8cc]"><tr>{["銘柄","ロジック","方向","数量","取得価格","現在価格","含み損益※","現在Gross","Total上限比"].map(n=><th key={n} className="px-3 py-3 font-medium">{n}</th>)}</tr></thead>
      <tbody>{positions.map(p=><tr key={p.id} onClick={()=>setSelected(p.id)} className={"cursor-pointer border-t border-[#2d4456] hover:bg-[#1b354b] "+(selected===p.id?"bg-[#1b4054]":"")}>
        <td className="px-3 py-3 font-semibold text-white">{p.symbol}</td><td className="px-3 py-3 font-semibold text-cyan-300">{p.logic}</td>
        <td className="px-3 py-3"><span className={"rounded-md px-2 py-1 text-[10px] font-bold "+(p.side==="LONG"?"bg-emerald-800/40 text-emerald-300":"bg-rose-900/35 text-rose-300")}>{p.side}</span></td>
        <td className="px-3 py-3">{fmtOpt(p.quantity)}</td><td className="px-3 py-3">{fmt(p.entry)}</td><td className="px-3 py-3">{fmtOpt(p.mark)}</td>
        <td className="px-3 py-3">{p.quantity!==null&&p.mark!==null?fmt((p.mark-p.entry)*p.quantity*(p.side==="LONG"?1:-1))+" USD/USDT":"—"}</td>
        <td className="px-3 py-3">{p.gross!==null?p.gross.toFixed(2)+"x":"未算定"}</td><td className="px-3 py-3">{p.gross!==null?(100*p.gross/replay.limits.total).toFixed(1)+"%":"—"}</td>
      </tr>)}{positions.length===0&&<tr><td colSpan={9} className="px-3 py-8 text-center text-[#91a7bf]">この時点の保有建玉はありません</td></tr>}</tbody></table></div>
      <p className="mt-2 text-[10px] text-[#8199b2]">※参考含み損益は数量と価格がある場合のみ簡易計算。USD/USDT換算値をJPY口座残高と直接合算しません。</p>
    </section>
    {selectedEvent&&<section className={card+" border-cyan-600/50 p-4"}><h2 className="mb-2 text-[14px] font-bold text-cyan-100">選択したイベントの詳細</h2><p className="mb-2 break-all font-mono text-[12px] text-[#d1e3ef]">{selectedEvent}</p><div className="flex flex-wrap gap-4 text-xs text-[#91aac2]"><span>発生時刻：{titleCase(frame.timestamp)}</span><span>総Gross：{total.toFixed(3)}x</span><span>保有建玉：{frame.positions.length}</span></div><p className="mt-2 text-[11px] text-amber-200">表示は記録スナップショット単位です。厳密な注文前後の残高を示すものではありません。</p></section>}
  </div>}
  {tab==="results"&&<div className="space-y-4">
    <section className={card+" p-5"}>
      <div className="mb-4 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-[17px] font-bold text-white"><BarChart3 className="h-5 w-5 text-cyan-300"/>BT検証結果</h2><span className="text-xs text-amber-200">{sourceLabel}</span></div>
      <p className="mb-4 text-[12px] text-[#93aabd]">{replay.researchSummary?"研究BTマニフェストの集計結果です。最新LIVE・署名済み実約定の証明ではありません。":"デモには検証済み成績がありません。現在の画面は合成データの可視化です。"}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {([
          ["開始資金","¥ "+fmt(replay.researchSummary?.initialJpy??initialEquity)],
          ["最終残高","¥ "+fmt(replay.researchSummary?.finalEquityJpy??replay.frames[replay.frames.length-1].equity)],
          ["勝率",replay.researchSummary?replay.researchSummary.winRatePct.toFixed(2)+"%":"—"],
          ["最大DD",replay.researchSummary?replay.researchSummary.maxDdPct.toFixed(2)+"%":"—"],
          ["Profit Factor",replay.researchSummary?replay.researchSummary.profitFactor.toFixed(3):"—"],
          ["モデル取引",replay.researchSummary?replay.researchSummary.modelFills.toLocaleString():"—"]
        ] as const).map(([name,val])=><div key={name} className={metric}><p className="mb-3 text-xs text-[#8ea7be]">{name}</p><p className="text-lg font-bold text-cyan-100">{val}</p></div>)}
      </div>
    </section>
    <div className="grid gap-4 xl:grid-cols-2"><section className={card+" p-4"}><h2 className="mb-3 text-[16px] font-bold text-white">資産推移とDrawdown</h2><EquityTimelineChart frames={replay.frames} cursor={replay.frames.length-1}/></section><GrossAllocationPanel frame={replay.frames[replay.frames.length-1]} limits={replay.limits} selected={selected} onSelect={setSelected} researchManifestCap={replay.source?.grossCapEvidence==="SOURCE_SUMMARY_MATCHED_RESEARCH_ONLY"} unverifiedCap={replay.source?.grossCapEvidence==="USER_SUPPLIED_NOT_VERIFIED"}/></div>
    <section className={card+" p-4"}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-[16px] font-bold text-white">ロジック×通貨別の検証</h2><button className="rounded-lg border border-[#3b627c] px-3 py-2 text-xs text-cyan-200" onClick={exportStrategyStats}>CSV出力</button></div>
      {(replay.strategyStats?.length??0)>0?<div className="max-h-[450px] overflow-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="sticky top-0 bg-[#1a3249] text-[#a7bcd0]"><tr>{["ロジック","通貨","モデル取引","決済数","勝率","純損益（JPY）","単独最大損失"].map(t=><th key={t} className="p-3">{t}</th>)}</tr></thead><tbody>{[...(replay.strategyStats??[])].sort((a,b)=>(a.winRatePct??100)-(b.winRatePct??100)).map(r=><tr key={r.logic+"-"+r.symbol} className="border-t border-[#2a4357]"><td className="p-3 font-semibold text-cyan-300">{r.logic}</td><td className="p-3">{r.symbol}</td><td className="p-3">{r.tradeCount}</td><td className="p-3">{r.closedCount}</td><td className="p-3">{r.winRatePct===null?"—":r.winRatePct.toFixed(1)+"%"}</td><td className={"p-3 "+(r.netPnlJpy<0?"text-rose-300":"text-emerald-300")}>{fmt(r.netPnlJpy)}</td><td className="p-3 text-rose-300">{r.maxLossJpy===null?"—":fmt(r.maxLossJpy)}</td></tr>)}</tbody></table></div>:<p className="rounded-lg bg-[#11263a] p-6 text-sm text-[#91abc0]">研究BTのロジック×通貨別集計は未読込です。デモ画面には実測成績を生成しません。</p>}
    </section>
  </div>}
  {tab==="report"&&<div className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
    <section className={card+" p-5"}><h2 className="mb-2 flex items-center gap-2 text-[17px] font-bold text-white"><FileText className="h-5 w-5 text-cyan-300"/>レポート・エクスポート</h2><p className="mb-5 text-xs leading-6 text-[#94aec3]">取引イベント・資産時系列・Gross・ロジック別のデータをCodex/GPTでも点検できる形式で出力します。研究データの証拠能力は元SHAの検証が必要です。</p>
      <div className="grid gap-2 sm:grid-cols-2">{([
        ["JSONデータをDL",()=>saveFile("bt_replay.json",JSON.stringify(replay,null,2),"application/json")],
        ["資産・Gross CSV",exportTimeline],
        ["建玉時系列 CSV",exportPositions],
        ["ロジック別 CSV",exportStrategyStats],
        ["GPT / Codex用 ZIP",exportPackage]
      ] as const).map(([name,action])=><button key={name} type="button" onClick={action} className="flex items-center justify-center gap-2 rounded-xl border border-[#3b6179] bg-[#19344a] px-4 py-3 text-[13px] font-semibold text-cyan-100 hover:border-cyan-400"><Download className="h-4 w-4"/>{name}</button>)}</div>
      <label className="mt-5 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-cyan-600 bg-[#102b40] px-4 py-4 text-[13px] text-cyan-100"><Upload className="h-4 w-4"/>研究BTのJSONを読み込んで検証<input className="sr-only" type="file" accept=".json" onChange={upload}/></label>
      {error&&<p className="mt-3 rounded-lg border border-rose-500/50 p-3 text-xs text-rose-200">{error}</p>}
      {savedNotice&&<p className="mt-3 text-xs text-cyan-200">{savedNotice}</p>}
    </section>
    <section className={card+" p-5"}><h2 className="mb-3 text-[16px] font-bold text-white">データの出所と整合性</h2>
      <div className="space-y-3 text-xs">{[["モード",sourceLabel],["モデル実装参照SHA",replay.engineSha],["時点数",replay.frames.length.toLocaleString()+" スナップショット"],["BTC確定足",String(replay.btcCandles?.length??0)+" 本"],["Total Gross上限",replay.limits.total.toFixed(2)+"x"],["Crypto / Stock",replay.limits.crypto.toFixed(2)+"x / "+replay.limits.stock.toFixed(2)+"x"]].map(([k,v])=><div key={k} className="flex items-start justify-between gap-4 border-b border-[#2c4055] pb-2"><span className="text-[#8fa7bd]">{k}</span><span className="max-w-[60%] break-all text-right font-mono text-[#d8eaf8]">{v}</span></div>)}</div>
      <p className="mt-4 rounded-lg border border-amber-700/40 bg-amber-950/10 p-3 text-[11px] leading-6 text-amber-100">現在の画面は再生・可視化専用です。最新の正規BTエンジン、現在の各Runner SHA、数量・価格・個別Grossの完全照合が済むまで新規BT実行を有効化しません。</p>
      <button type="button" onClick={()=>setTab("library")} className="mt-4 w-full rounded-lg bg-[#20506b] px-3 py-3 text-[13px] font-semibold text-cyan-100">保存ライブラリを開く</button>
    </section>
  </div>}
  {tab==="library"&&<div className="space-y-4">
    <section className={card+" p-5"}><h2 className="mb-3 flex items-center gap-2 text-[17px] font-bold text-white"><Save className="h-5 w-5 text-cyan-300"/>BT保存ライブラリ</h2><p className="mb-4 text-xs text-[#97aec1]">再生データと参照条件を保存し、後から再生・JSONダウンロードできます。</p>
      <div className="mb-4 flex flex-wrap items-center gap-3"><input aria-label="BT保存名" value={runName} onChange={e=>setRunName(e.target.value)} className={inputCls+" max-w-[340px]"} placeholder="BT保存名"/><button type="button" onClick={saveLibrary} className="flex items-center gap-2 rounded-xl border border-cyan-400 bg-[#14616b] px-5 py-3 text-[13px] font-semibold text-white"><Save className="h-4 w-4"/>ブラウザーに保存</button></div>
      {savedNotice&&<p className="mb-3 text-[12px] text-cyan-200">{savedNotice}</p>}
      <p className="mb-2 text-xs text-[#8ca5bb]">ブラウザー内保存（別端末とは自動共有されません）</p>
      <div className="space-y-2">{savedRuns.length?savedRuns.map(item=><div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2d4b60] bg-[#122a3d] px-4 py-3"><span className="text-[12px] text-[#d8e6f1]"><strong>{item.name}</strong><span className="ml-2 text-[#86a0b7]">{item.frames}時点 / {item.createdAt}</span></span><div className="flex flex-wrap gap-2"><button className="rounded-lg bg-[#22516b] px-3 py-2 text-[11px]" onClick={()=>loadLibrary(item.id)}>再読込</button><button className="rounded-lg bg-[#244257] px-3 py-2 text-[11px]" onClick={()=>downloadLibrary(item.id)}>JSON DL</button><button className="rounded-lg bg-[#5a2738] px-3 py-2 text-[11px]" onClick={()=>removeLibrary(item.id)}>削除</button></div></div>):<p className="rounded-xl border border-dashed border-[#36536c] p-6 text-center text-sm text-[#8ca7bb]">ブラウザー内の保存データはまだありません。</p>}</div>
    </section>
    {SHOW_SERVER_ARCHIVE&&<section className={card+" p-5"}><h2 className="mb-2 text-[16px] font-bold text-white">Owner認証付きサーバー保存</h2><p className="mb-4 text-xs text-[#93aec1]">専用保存先とOriginが設定され、Owner認証が成立している場合のみ利用可能です。未設定の場合は安全側に拒否されます。</p>
      <div className="mb-3 flex flex-wrap gap-2"><button onClick={saveServerRun} className="rounded-lg border border-[#336f86] bg-[#164257] px-4 py-2.5 text-xs text-cyan-100">サーバーへ保存</button><button onClick={refreshServerRuns} className="rounded-lg bg-[#243d52] px-4 py-2.5 text-xs text-slate-200">保存一覧を更新</button></div>
      {serverNotice&&<p className="mb-3 text-xs text-cyan-200">{serverNotice}</p>}
      <div className="space-y-2">{serverRuns.map(item=><div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#304b60] p-3"><span className="text-xs">{item.name}・{item.frames}時点・{(item.bytes/1024/1024).toFixed(1)}MB</span><div className="flex flex-wrap gap-2"><button className="rounded bg-[#255876] px-3 py-1.5 text-xs" onClick={()=>loadServerRun(item.id)}>再生</button><button className="rounded bg-[#275068] px-3 py-1.5 text-xs" onClick={()=>downloadServerRun(item.id)}>JSON DL</button><button className="rounded bg-rose-900/60 px-3 py-1.5 text-xs" onClick={()=>deleteServerRun(item.id)}>削除</button></div></div>)}</div>
    </section>}
    <p className="text-[12px] text-[#8ca4b8]">Read-only / 研究リプレイ・DEMO。LIVE Runner・注文・STOP・Kill Switchには非接続です。</p>
  </div>}
</BTWorkspaceShell>;
}
