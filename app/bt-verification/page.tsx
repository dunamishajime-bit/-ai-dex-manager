"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { Activity, ArrowRight, Download, FileUp, Pause, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { BTWorkspaceShell, type BTWorkspaceTab } from "@/components/bt-verification/BTWorkspaceShell";
import { BTResearchConditions } from "@/components/bt-verification/BTResearchConditions";
import { ResearchSymbolCharts } from "@/components/bt-verification/ResearchSymbolCharts";
import { BtcCandlestickChart } from "@/components/bt-verification/BtcCandlestickChart";
import { EquityTimelineChart } from "@/components/bt-verification/EquityTimelineChart";
import { GrossAllocationPanel } from "@/components/bt-verification/GrossAllocationPanel";
import { createPreviewReplay, type DemoScenario, DEMO_BASE_JPY } from "@/lib/bt-verification/demo";
import { grossForFrame, validateReplay, type Replay, type ReplayFrame } from "@/lib/bt-verification/replay";
import {portfolioMetrics} from "@/lib/bt-verification/portfolio-metrics";
import {compareReplayPair} from "@/lib/bt-verification/compare-replays";

const SCENARIOS: { value: DemoScenario; label: string; hint: string }[] = [
  { value: "trend", label: "上昇トレンド", hint: "トレンドが続く相場" },
  { value: "range", label: "レンジ相場", hint: "一定の値幅を往復" },
  { value: "down", label: "下落トレンド", hint: "下降方向の値動き" },
  { value: "volatile", label: "高ボラティリティ", hint: "急変動・ジャンプを含む" },
];
const JPY = (value: number) => "¥" + value.toLocaleString("ja-JP", { maximumFractionDigits: 0 });
const NUM = (value: number) => value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
const pct = (value: number) => value.toFixed(2) + "%";

function download(name: string, contents: string, mime: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csv(rows: (string | number)[][]) {
  return rows.map((row) => row.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\r\n") + "\r\n";
}
const tile = "rounded-xl border border-[#29475b] bg-[linear-gradient(145deg,#13283b,#0d1e30)] p-4 shadow-[0_8px_32px_rgba(1,10,26,.16)]";
const button = "inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-600/50 bg-[#17485c] px-4 py-2.5 text-sm font-semibold text-cyan-50 transition-colors hover:bg-[#1b6074] disabled:opacity-40";

export default function BTVerification() {
  const [tab, setTab] = useState<BTWorkspaceTab>("config");
  const [scenario, setScenario] = useState<DemoScenario>("trend");
  const [seed, setSeed] = useState(123456);
  const [replay, setReplay] = useState<Replay>(() => createPreviewReplay(123456, "trend"));
  const [cursor, setCursor] = useState(0);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<1 | 5 | 20>(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [notice, setNotice] = useState("");
  const [baselineFiles,setBaselineFiles]=useState<Record<string,{label:string;replay:Replay}>>({});
  const [baselineSelected,setBaselineSelected]=useState("");
  const [comparisonA,setComparisonA]=useState("IDLE_10");
  const [comparisonB,setComparisonB]=useState("IDLE_30");
  function openBaseline(key:string){
    const item=baselineFiles[key];
    if(!item)return;
    setReplay(item.replay);setCursor(0);setRunning(false);setSelected(null);
    setFileName(item.label);setTab("playback");
  }
  async function importBaselineSet(event:ChangeEvent<HTMLInputElement>){
    const files=Array.from(event.currentTarget.files??[]);
    event.currentTarget.value="";
    if(!files.length)return;
    if(files.length>7||files.some(f=>f.size>24*1024*1024)){
      setNotice("基準BTのMANIFESTと最大6件のJSONを選んでください。各ファイルは24MB以下です。");return;
    }
    try {
      const manifestFile=files.find(f=>f.name==="MANIFEST_UNCERTIFIED.json");
      if(!manifestFile)throw new Error("同じフォルダー内のMANIFEST_UNCERTIFIED.jsonも選んでください。");
      const manifest:unknown=JSON.parse(await manifestFile.text());
      if(!manifest||typeof manifest!=="object")throw new Error("MANIFEST不正");
      const m=manifest as {exports?:unknown;integrated_eight_runner?:unknown;production_parity_verified?:unknown;actual_exchange_fills_verified?:unknown};
      if(m.integrated_eight_runner!==false||m.production_parity_verified!==false||
         m.actual_exchange_fills_verified!==false||!Array.isArray(m.exports)||
         m.exports.length!==6)throw new Error("基準BTの認証状態または件数が一致しません。");
      const lookup=new Map<string,{sha256:string;strategy:string;bps:number}>();
      for(const entry of m.exports){
        if(!entry||typeof entry!=="object")throw new Error("MANIFEST項目不正");
        const row=entry as {file?:unknown;sha256?:unknown;strategy?:unknown;bps?:unknown};
        if(typeof row.file!=="string"||!/^disdex-baseline-20251001-20261001-(idle|fet|hype)-(10|30)bps-UNCERTIFIED\.json$/.test(row.file)||
           typeof row.sha256!=="string"||!/^[a-f0-9]{64}$/.test(row.sha256)||
           !["IDLE","FET","HYPE"].includes(String(row.strategy))||![10,30].includes(Number(row.bps))||
           lookup.has(row.file))throw new Error("MANIFESTのシナリオ定義不正");
        lookup.set(row.file,{sha256:row.sha256,strategy:String(row.strategy),bps:Number(row.bps)});
      }
      const imports:Record<string,{label:string;replay:Replay}>={};
      for(const file of files.filter(f=>f!==manifestFile)){
        const entry=lookup.get(file.name);
        if(!entry)throw new Error("登録外の研究データ: "+file.name);
        const bytes=await file.arrayBuffer();
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)))
          .map(v=>v.toString(16).padStart(2,"0")).join("");
        if(digest!==entry.sha256)throw new Error("SHA256不一致: "+file.name);
        const parsed:unknown=JSON.parse(new TextDecoder("utf-8").decode(bytes));
        if(!validateReplay(parsed)||parsed.mode!=="EXTERNAL"||
           parsed.source?.kind!=="HISTORICAL_STANDALONE_MODEL_NOT_INTEGRATED"||
           parsed.engineSha!=="REUSABLE_STANDALONE_MODEL_UNCERTIFIED")throw new Error("研究BT形式不一致: "+file.name);
        if(parsed.frames.some(f=>f.positions.length>0))throw new Error("未確認建玉が含まれています。");
        const key=entry.strategy+"_"+entry.bps;
        imports[key]={label:entry.strategy+" / "+entry.bps+"bps（未認証・単独研究）",replay:parsed};
      }
      if(!Object.keys(imports).length)throw new Error("研究データがありません。");
      setBaselineFiles(imports);setBaselineSelected(Object.keys(imports).sort()[0]);
      setNotice(Object.keys(imports).length+"件をSHA256照合し、このブラウザに読み込みました。全8系統統合BTではありません。");
      setTab("config");
    }catch(error){setNotice(error instanceof Error?error.message:"基準BT読込に失敗しました。");}
  }

  const isDemo = replay.mode === "DEMO";
  const totalFrames = replay.frames.length;
  const last = totalFrames - 1;
  useEffect(() => {
    if (!running) return;
    const step = isDemo ? (speed === 20 ? 3 : speed === 5 ? 2 : 1) : Math.max(1, Math.floor(speed * totalFrames / 1200));
    const delay = isDemo ? (speed === 20 ? 40 : speed === 5 ? 58 : 90) : 90;
    const timer = setInterval(() => setCursor((value) => Math.min(last, value + step)), delay);
    return () => clearInterval(timer);
  }, [running, speed, isDemo, totalFrames, last]);
  useEffect(() => { if (cursor >= last) setRunning(false); }, [cursor, last]);

  const frame = replay.frames[cursor];
  const summary = useMemo(() => portfolioMetrics(replay.frames, cursor), [replay, cursor]);
  const events = useMemo(() => replay.frames.slice(0, cursor + 1).flatMap((f, i) =>
    f.events.map((event) => ({ event, time: f.timestamp, index: i }))).slice(-80).reverse(), [replay, cursor]);
  const entryCount = events.filter(({ event }) => event.includes("ENTRY ")).length;
  const gross = grossForFrame(frame);
  const anchoredPriceOnly = replay.source?.kind === "SYNTHETIC_ANCHORED_DAILY_NO_STRATEGY";
  const comparison = useMemo(()=>baselineFiles[comparisonA] && baselineFiles[comparisonB] && comparisonA!==comparisonB
    ?compareReplayPair(baselineFiles[comparisonA].replay,baselineFiles[comparisonB].replay):null,
    [baselineFiles,comparisonA,comparisonB]);
  const sourceLabel = anchoredPriceOnly ? "前日終値アンカー・価格のみ（戦略未接続）" : isDemo ? "模擬デモ・実取引なし" : "持込BTデータ・未認証";
  const sourceWarning = anchoredPriceOnly
    ? "前日実終値をAster公開日足で検証し、指定期間の価格のみ人工生成しています。実取引、Productionロジック判定、仮想約定は実施していません。"
    : isDemo
    ? "ここでのローソク足・判定・約定・損益はすべて模擬生成です。実際のV4・PENGU・Q102のロジックや過去相場、運用成績とは一致しません。"
    : "持込データの形式を検証して表示しています。実相場や最新LIVE pinとの一致・約定の正しさを認証したものではありません。";

  function makeDemo(nextScene: DemoScenario = scenario, nextSeed: number = seed) {
    setRunning(false); setScenario(nextScene); setSeed(nextSeed);
    setReplay(createPreviewReplay(nextSeed, nextScene));
    setCursor(0); setSelected(null); setFileName(""); setNotice("");
    setTab("playback");
  }
  async function importReplay(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > 24 * 1024 * 1024) { setNotice("24MB以下の再生JSONを選んでください。"); return; }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!validateReplay(parsed)) throw new Error("BTの再生データ形式が一致しません");
      if (parsed.mode !== "EXTERNAL") throw new Error("この画面への読込は研究BTのEXTERNAL形式のみ対応します");
      setReplay(parsed); setCursor(0); setRunning(false); setSelected(null); setFileName(file.name);
      setNotice("再生データを読み込みました。検証済みのLIVE実績ではありません。");
      setTab("playback");
    } catch (error) { setNotice(error instanceof Error ? error.message : "読込に失敗しました。"); }
  }
  const display = (content: ReactNode) => <div className="space-y-5">{content}</div>;
  return (
    <BTWorkspaceShell activeTab={tab} onTabChange={setTab} sourceStatus={sourceLabel}>
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#486071] bg-[#12263a] p-3 text-xs leading-6 text-[#bed1e0]">
        <ShieldCheck className="mt-1 h-4 w-4 shrink-0 text-cyan-300" />
        <span>{sourceWarning} LIVEの注文・STOP・Runner・GLOBAL HOLD・Shared Riskは一切操作しません。</span>
      </div>

      {tab === "config" && display(<>
        <BTResearchConditions onReplay={(generated) => {setReplay(generated);setCursor(0);setRunning(false);setSelected(null);setFileName("");setTab("playback");}}
          onOpenLibrary={()=>setTab("library")}
          availableBaselines={Object.entries(baselineFiles).map(([key,item])=>({key,label:item.label}))}
          selectedBaseline={baselineSelected}
          onChangeBaseline={setBaselineSelected}
          onLoadBaseline={openBaseline}/>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className={tile}>
            <h2 className="text-lg font-bold text-white">模擬BTの条件設定</h2>
            <p className="mt-2 text-xs leading-6 text-[#95b5ca]">実データを用いた正規BT計算ではありません。4種類の人工市場で、発火・決済の見え方を確認できます。</p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {SCENARIOS.map((item) => <button type="button" key={item.value} onClick={() => setScenario(item.value)}
                className={"rounded-xl border p-4 text-left transition-colors " + (scenario === item.value
                  ? "border-cyan-400 bg-[#153f53]" : "border-[#2b455b] bg-[#0d2134] hover:border-[#44728e]")}>
                <div className="text-sm font-bold text-slate-100">{item.label}</div>
                <div className="mt-1 text-xs text-[#91aec4]">{item.hint}</div>
              </button>)}
            </div>
            <label className="mt-5 block text-xs text-[#a5c1d3]">人工市場シード（同じ値なら同じ値動き）</label>
            <input type="number" min={1} max={999999999} value={seed} onChange={(e) => setSeed(Math.max(1, Math.min(999999999, Number(e.target.value) || 1)))}
              className="mt-2 w-full rounded-lg border border-[#365a70] bg-[#0a1b2b] px-3 py-2 text-sm text-white"/>
            <p className="mt-3 text-xs text-[#86a6bd]">初期資金：{JPY(DEMO_BASE_JPY)} / BTC 1時間足 / 5分刻みの値動き / 模擬判定3系統</p>
            <button type="button" className={button + " mt-5 w-full"} onClick={() => makeDemo()}>
              <Play className="h-4 w-4" /> 模擬チャートを開始
            </button>
          </section>
          <section className={tile}>
            <h2 className="text-lg font-bold text-white">チャートプレビュー</h2>
            <p className="my-3 text-xs text-[#95b5ca]">ローソク足は時間の進行に合わせて高値・安値・終値が変動します。</p>
            <BtcCandlestickChart replay={replay} cursor={cursor} onEventSelect={(index) => {setCursor(index); setTab("playback");}} />
            <button type="button" onClick={() => setTab("playback")} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-cyan-300">
              現在の再生画面を開く <ArrowRight className="h-4 w-4" />
            </button>
          </section>
        </div>
      </>)}

      {tab === "playback" && display(<>
        <section className={tile}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-bold text-white">時間同期リプレイ</h2>
              <p className="text-xs text-[#86a8bd]">{frame.timestamp.replace("T", " ").slice(0, 16)} UTC・{NUM(cursor + 1)} / {NUM(totalFrames)} フレーム</p></div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => {if(cursor >= last)setCursor(0);setRunning((v) => !v);}} className={button}>
                {running ? <Pause className="h-4 w-4"/> : <Play className="h-4 w-4"/>}{running ? "一時停止" : "再生"}
              </button>
              <button type="button" onClick={() => {setRunning(false);setCursor(0);}} aria-label="先頭に戻す" className={button}><RotateCcw className="h-4 w-4"/></button>
              {([1, 5, 20] as const).map((v) => <button type="button" key={v} onClick={() => setSpeed(v)}
                className={"rounded-lg border px-3 py-2 text-xs font-semibold " + (speed === v ? "border-cyan-400 bg-[#1d536a] text-white" : "border-[#35556b] text-[#91afc4]")}>{v}×</button>)}
            </div>
          </div>
          <input type="range" aria-label="時点シーク" min={0} max={last} step={1} value={cursor}
            onChange={(e) => {setRunning(false);setCursor(Number(e.target.value));}} className="mt-5 w-full accent-cyan-400"/>
        </section>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[["評価資産", JPY(summary.current)], ["確定損益・モデル", JPY(frame.realized)],
            ["期間最大DD（再生済）", pct(summary.maxDD)], ["総Gross", (isDemo || frame.gross ? NUM(gross.total)+"x" : "未確認")]].map(([name, value]) =>
            <div className={tile} key={name}><div className="text-xs text-[#8aacc3]">{name}</div><div className="mt-2 text-xl font-bold text-white">{value}</div></div>)}
        </div>
        <section className={tile}><BtcCandlestickChart replay={replay} cursor={cursor} onEventSelect={(index) => {setCursor(index); setRunning(false);}} /></section>
        <ResearchSymbolCharts replay={replay} cursor={cursor} onSelectEvent={(index)=>{setCursor(index);setRunning(false);}} />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <section className={tile}><h3 className="mb-3 text-base font-bold text-white">評価資産・ドローダウン</h3><EquityTimelineChart frames={replay.frames} cursor={cursor}/></section>
          <GrossAllocationPanel frame={frame} limits={replay.limits} unverifiedCap={!isDemo} researchManifestCap={false}
            onSelect={setSelected} selected={selected}/>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <section className={tile}>
            <h3 className="mb-3 font-bold text-white">保有モデル建玉 {frame.positions.length}件</h3>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {frame.positions.length === 0 ? <p className="text-sm text-[#94aec1]">この時点のモデル建玉はありません。</p> :
                frame.positions.map((p) => <div key={p.id} className="rounded-lg border border-[#294257] bg-[#0b1d2e] p-3 text-xs text-[#b9cfe0]">
                  <div className="flex items-center justify-between"><strong className="text-cyan-200">{p.logic} / {p.symbol}</strong><span>{p.side}</span></div>
                  <div className="mt-1">Entry {NUM(p.entry)} / Mark {p.mark == null ? "未取得" : NUM(p.mark)} / Gross {p.gross == null ? "未算定" : NUM(p.gross) + "x"}</div>
                </div>)}
            </div>
          </section>
          <section className={tile}>
            <h3 className="mb-3 font-bold text-white">発火・決済・リスクイベント</h3>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {events.length ? events.slice(0, 35).map((ev, i) => <button key={ev.index + "-" + i} type="button" onClick={() => {setRunning(false);setCursor(ev.index);}}
                className="w-full rounded-lg border border-[#294257] bg-[#0b1d2e] p-2 text-left text-xs text-[#c4d5e4] hover:border-cyan-500">
                <span className="block font-mono text-[#7ea8c1]">{ev.time.slice(0, 16)}</span>{ev.event}
              </button>) : <p className="text-sm text-[#94aec1]">イベントはまだありません。</p>}
            </div>
          </section>
        </div>
      </>)}

      {tab === "results" && display(<>
        <section className={tile}><h2 className="text-lg font-bold text-white">再生区間の検証結果</h2>
          <p className="mt-1 text-xs text-[#91aec4]">以下は{isDemo ? "人工市場の模擬結果" : "持込研究データの再生結果"}です。LIVE実績の証明ではありません。</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[["開始資金", JPY(summary.first)], ["現在資産", JPY(summary.current)], ["入金控除後の運用損益", JPY(summary.net)],
              ["積立累計", JPY(summary.netDeposits)],
              ["最大DD", pct(summary.maxDD)], ["モデル建玉", frame.positions.length + "件"], ["イベント（直近80件）", events.length + "件"],
              ["総Gross", (isDemo || frame.gross ? NUM(gross.total)+"x" : "未確認")], ["対象時点", (cursor + 1) + "/" + totalFrames]].map(([name, value]) =>
              <div key={name} className="rounded-lg border border-[#2a4459] bg-[#0c2033] p-4"><p className="text-xs text-[#91adc3]">{name}</p><p className="mt-2 text-lg font-bold text-white">{value}</p></div>)}
          </div>
        </section>
        <section className={tile}><EquityTimelineChart frames={replay.frames} cursor={cursor}/></section>
        {Object.keys(baselineFiles).length>=2&&<section className={tile}>
          <h3 className="text-base font-bold text-white">同一データ・コスト条件比較（単独研究モデル）</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-[#9bbbd0]">比較A
              <select className="mt-1 block w-full rounded-lg border border-[#365a70] bg-[#0a1b2b] p-2 text-sm text-white" value={comparisonA} onChange={e=>setComparisonA(e.target.value)}>
                {Object.entries(baselineFiles).map(([key,item])=><option key={key} value={key}>{item.label}</option>)}
              </select>
            </label>
            <label className="text-xs text-[#9bbbd0]">比較B
              <select className="mt-1 block w-full rounded-lg border border-[#365a70] bg-[#0a1b2b] p-2 text-sm text-white" value={comparisonB} onChange={e=>setComparisonB(e.target.value)}>
                {Object.entries(baselineFiles).map(([key,item])=><option key={key} value={key}>{item.label}</option>)}
              </select>
            </label>
          </div>
          <p className={"mt-3 text-xs leading-6 "+(comparison?.comparable?"text-cyan-200":"text-amber-200")}>
            {comparison?.reason??"比較する異なる2データを選択してください。"}
          </p>
          {comparison?.comparable&&comparison.stats&&<div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-[#29465a] bg-[#0a1b2d] p-3"><p className="text-xs text-[#91afc4]">Aの運用損益</p><p className="mt-1 font-semibold">{JPY(comparison.stats.pnlA)}</p></div>
            <div className="rounded-lg border border-[#29465a] bg-[#0a1b2d] p-3"><p className="text-xs text-[#91afc4]">Bの運用損益</p><p className="mt-1 font-semibold">{JPY(comparison.stats.pnlB)}</p></div>
            <div className="rounded-lg border border-[#29465a] bg-[#0a1b2d] p-3"><p className="text-xs text-[#91afc4]">B − A</p><p className="mt-1 font-semibold">{JPY(comparison.stats.pnlDifference)}</p></div>
            <p className="text-xs text-[#9eb8cb]">最大DD A: {pct(comparison.stats.maxDdA)} / B: {pct(comparison.stats.maxDdB)}</p>
          </div>}
        </section>}      </>)}

      {tab === "report" && display(<section className={tile}>
        <h2 className="text-lg font-bold text-white">BT再生レポート</h2>
        <p className="mt-2 text-sm text-[#9bb9cd]">再生結果をCSVに書き出して検証できます。実注文・最新LIVEの戦略判定には利用しません。</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-[#31536a] bg-[#0b2032] p-4 text-sm leading-8 text-[#bad0df]">
            データ種別：{sourceLabel}<br/>エンジン識別：<span className="break-all font-mono text-xs">{replay.engineSha}</span><br/>
            フレーム数：{NUM(totalFrames)}<br/>開始資金：{JPY(summary.first)}<br/>現在資産：{JPY(summary.current)}<br/>
            最大DD：{pct(summary.maxDD)}<br/>直近イベント内エントリー：{entryCount}件
          </div>
          <div className="flex flex-col justify-center gap-3">
            <button type="button" className={button} onClick={() => download("disdex-bt-portfolio.csv",
              csv([["utc","equity_jpy","realized_jpy","gross_total_x","gross_crypto_x","gross_stock_x","open_model_positions","net_deposits_jpy","trading_pnl_jpy"], ...replay.frames.map((f) => {
                const g = grossForFrame(f);return [f.timestamp, f.equity, f.realized, g.total, g.crypto, g.stock, f.positions.length, f.netDepositsJpy??0, f.tradingPnlJpy??(f.equity-replay.frames[0].equity-(f.netDepositsJpy??0))];
              })]),"text/csv;charset=utf-8")}>
              <Download className="h-4 w-4"/> 資産・GrossのCSVを保存
            </button>
            <button type="button" className={button} onClick={() => download("disdex-bt-events.csv",
              csv([["utc","event","source_kind"],...replay.frames.flatMap(f=>f.events.map(e=>[f.timestamp,e,replay.source?.kind??replay.mode]))]),
              "text/csv;charset=utf-8")}>
              <Download className="h-4 w-4"/> 発火・決済・入金のイベント台帳CSV
            </button>
            <button type="button" className={button} onClick={() => download("disdex-bt-evidence.json",
              JSON.stringify({mode:replay.mode,engineSha:replay.engineSha,seed:replay.seed,
                source:replay.source,frames:replay.frames.length,range:[replay.frames[0].timestamp,replay.frames.at(-1)?.timestamp],
                certification:"NOT_CERTIFIED_PRODUCTION_PARITY"}),"application/json")}>
              <Download className="h-4 w-4"/> 入力条件・証跡JSON
            </button>
            <button type="button" className={button} onClick={() => setTab("library")}>JSONの保存・読込へ</button>
            <p className="text-xs text-[#94b0c4]">研究BTの正規約定、LIVE一致認証、勝率の保証は行いません。</p>
          </div>
        </div>
      </section>)}

      {tab === "library" && display(<section className={tile}>
        <h2 className="text-lg font-bold text-white">保存データ・研究BTの読込</h2>
        <p className="mt-2 text-sm leading-7 text-[#9bb5c9]">この版ではブラウザから選んだJSONのみを端末内で読み込みます。サーバーに送信・保存しません。研究データはEXTERNAL形式のみ読み込み、LIVEと一致したものとして扱いません。</p>
        <div className="mt-4 rounded-xl border border-[#35546b] bg-[#0b2133] p-4 text-sm">
          現在のデータ：<strong className="text-cyan-200">{fileName || "人工市場デモ"}</strong><br/>
          <span className="text-xs text-[#91b1c4]">識別：{replay.source?.kind ?? replay.mode}</span>
        </div>
        <div className="mt-5 rounded-xl border border-cyan-700/40 bg-[#0c2336] p-4">
          <h3 className="text-sm font-bold text-cyan-100">基準BTセットの読み込み</h3>
          <p className="mt-2 text-xs leading-6 text-[#a8c4d4]">PC内で変換したMANIFEST_UNCERTIFIED.jsonと6つの研究再生JSONをまとめて選択してください。SHA256照合後、条件設定で単独モデルを選択できます。ブラウザ内だけで読み込み、サーバーへ送信しません。</p>
          <label className={button+" mt-3 cursor-pointer"}><FileUp className="h-4 w-4"/>基準BTセット（最大7ファイル）を選択
            <input className="sr-only" type="file" multiple accept=".json,application/json" onChange={importBaselineSet}/>
          </label>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <label className={button + " cursor-pointer"}><FileUp className="h-4 w-4"/>研究BTの再生JSONを読み込む
            <input className="sr-only" type="file" accept=".json,application/json" onChange={importReplay}/>
          </label>
          <button type="button" className={button} onClick={() => download("disdex-bt-replay.json", JSON.stringify(replay), "application/json")}>
            <Download className="h-4 w-4"/>現在の再生JSONを保存
          </button>
          <button type="button" className={button} onClick={() => makeDemo("trend",123456)}>
            <RotateCcw className="h-4 w-4"/>標準デモに戻す
          </button>
        </div>
        {notice && <p role="status" className="mt-4 text-sm text-cyan-200">{notice}</p>}
      </section>)}

      <div className="mt-5 flex items-center gap-2 text-xs text-[#7496af]">
        <Activity className="h-3.5 w-3.5" /> BT閲覧専用。正式BTエンジンの実行・最新LIVEとのパリティ認証は今後の別工程です。
      </div>
    </BTWorkspaceShell>
  );
}
