"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FlaskConical, Pause, Play, RotateCcw, Save, Upload } from "lucide-react";
import {
  computeBtGross, parseBtPortfolioRun,
  type BtGrossView, type BtPortfolioRun, type BtSnapshot, type BtEvent,
} from "@/lib/bt-portfolio-replay";
import { createBtUiDemo } from "@/lib/bt-ui-demo";
import { btExportFiles, btZip } from "@/lib/bt-export-package";

const LOGICS = ["V4", "V12", "PENGU", "V52", "Q102", "HYPE", "FET", "IDLE"];
const SYMBOLS = ["BTC", "ETH", "SOL", "DOGE", "AVAX", "PENGU", "FET", "HYPE", "NEAR", "AMZN"];
const DEFAULT_LIMITS = { totalX: 3.5, cryptoX: 3, stockX: 1.5 };
const COLORS = ["#26dec3", "#68acff", "#c494f4", "#f9be64", "#ff7185", "#75d798", "#c6d77f"];
const STORE_KEY = "disdex_bt_replay_v1";
const panel = "rounded-2xl border border-[#2a4560] bg-[#081927]/95 p-4";
const action = "rounded-lg border border-[#355878] bg-[#112b42] px-3 py-2 text-xs font-semibold text-sky-100 hover:bg-[#1c3e58] disabled:opacity-40";
const money = (n: number, currency = "USD") => (n > 0 ? "+" : "") + n.toLocaleString("ja-JP", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + " " + currency;
const fixed = (n: number, places = 2) => n.toLocaleString("ja-JP", { maximumFractionDigits: places, minimumFractionDigits: places });
const fmtDate = (t: string) => new Date(t).toLocaleString("ja-JP", { timeZone: "UTC", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) + " UTC";
const tone = (n: number) => n < 0 ? "text-rose-400" : n > 0 ? "text-emerald-400" : "text-white";
type Tab = "setup" | "play" | "report";
type Saved = { key: string; label: string; run: BtPortfolioRun };

function GrossMeter({ label, used, limit, lines }: { label: string; used: number; limit: number; lines?: BtGrossView["lines"] }) {
  const pct = used / limit * 100;
  const sum = lines?.reduce((s, x) => s + x.grossX, 0) || 0;
  return <div className="space-y-1.5">
    <div className="flex justify-between gap-2 text-xs">
      <span className="text-slate-300">{label}</span>
      <span><b className="text-base text-white">{fixed(used)} / {fixed(limit)}x</b><span className={pct > 100 ? "ml-2 text-rose-400" : "ml-2 text-teal-300"}>{fixed(pct, 1)}%</span></span>
    </div>
    <div className="h-4 overflow-hidden rounded-full bg-[#203344]">
      <div className="flex h-full" style={{ width: String(Math.min(pct, 100)) + "%" }}>
        {lines?.length ? lines.map((x, i) => <div key={x.kind + x.id} title={x.logic + "/" + x.symbol + ": " + fixed(x.grossX) + "x"} style={{ width: String(sum ? x.grossX / sum * 100 : 0) + "%", backgroundColor: COLORS[i % COLORS.length] }} />) : <div className="h-full w-full bg-teal-400" />}
      </div>
    </div>
  </div>;
}

function HistoryChart({ data, index, field, click }: { data: BtSnapshot[]; index: number; field: "btcPrice" | "equity"; click?: (i: number) => void }) {
  const from = Math.max(0, index - 79);
  const rows = data.slice(from, index + 1);
  const values = rows.map((r) => field === "equity" ? r.equity : r.btcPrice || NaN).filter(Number.isFinite);
  if (values.length === 0) return <div className="flex h-48 items-center justify-center rounded-lg border border-[#2c4a62] text-xs text-slate-400">BTC価格の時系列が台帳にありません。実データを正規BTから出力してください。</div>;
  const low = Math.min(...values), high = Math.max(...values);
  const spread = Math.max(high - low, high * 0.006, 1);
  const x = (i: number) => 22 + 727 * i / Math.max(1, rows.length - 1);
  const y = (p: number) => 211 - (p - low + spread * 0.08) * 168 / (spread * 1.16);
  const d = rows.map((r, i) => {
    const p = field === "equity" ? r.equity : r.btcPrice || 0;
    return (i ? "L" : "M") + String(x(i)) + " " + String(y(p));
  }).join(" ");
  return <svg viewBox="0 0 775 250" role="img" aria-label={field === "equity" ? "資産推移" : "BTC代表チャート"} className="w-full">
    {[0, 1, 2, 3, 4].map((v) => <line key={v} x1="20" x2="754" y1={26 + v * 44} y2={26 + v * 44} stroke="#263a4d" />)}
    <path d={d} fill="none" stroke={field === "equity" ? "#21e1c6" : "#81bfff"} strokeWidth="2.7" strokeLinejoin="round" />
    {field === "btcPrice" && rows.flatMap((r, i) => (r.events || []).filter((e) => e.type === "ENTRY" || e.type === "EXIT").map((e) =>
      <g key={e.id} onClick={() => click?.(from + i)} style={{ cursor: "pointer" }}>
        <circle cx={x(i)} cy={y(r.btcPrice || low)} r="6" stroke="#061726" strokeWidth="2" fill={e.type === "ENTRY" ? "#80baff" : (e.realizedPnl || 0) >= 0 ? "#36e2af" : "#f65d7a"} />
        <title>{e.logic + " " + e.symbol + " " + e.type + " " + (e.realizedPnl == null ? "" : money(e.realizedPnl))}</title>
      </g>
    ))}
    <text x="24" y="16" fill="#9bb3c8" fontSize="13">{fixed(high)}</text>
    <text x="24" y="240" fill="#a6bace" fontSize="12">{fmtDate(rows[0].timestamp)}</text>
    <text x="615" y="240" fill="#a6bace" fontSize="12">{fmtDate(rows[rows.length - 1].timestamp)}</text>
  </svg>;
}

function saveDownload(name: string, bytes: string | Uint8Array, mime: string) {
  const data: BlobPart = typeof bytes === "string" ? bytes : Uint8Array.from(bytes).buffer;
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const link = document.createElement("a");
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BtVerificationPage() {
  const [tab, setTab] = useState<Tab>("setup");
  const [mode, setMode] = useState<"UI_DEMO" | "REAL_BT">("UI_DEMO");
  const [logics, setLogics] = useState<string[]>(["V4", "PENGU", "Q102"]);
  const [symbols, setSymbols] = useState<string[]>(["BTC", "PENGU", "AVAX"]);
  const [seed, setSeed] = useState("123456");
  const [initial, setInitial] = useState("10000");
  const [speed, setSpeed] = useState(5);
  const [run, setRun] = useState<BtPortfolioRun | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [saveName, setSaveName] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<BtEvent | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || "[]") as Saved[];
      setSaved(s.filter((v) => { try { parseBtPortfolioRun(v.run); return true; } catch { return false; } }));
    } catch { setSaved([]); }
  }, []);
  useEffect(() => {
    if (!playing || !run) return;
    const timer = window.setInterval(() => setStep((x) => Math.min(run.snapshots.length - 1, x + speed)), 350);
    return () => window.clearInterval(timer);
  }, [playing, run, speed]);
  useEffect(() => {
    if (run && step >= run.snapshots.length - 1) setPlaying(false);
  }, [run, step]);

  const snapshot = run?.snapshots[Math.min(step, run.snapshots.length - 1)];
  const gross = useMemo(() => run && snapshot ? computeBtGross(snapshot, run.limits) : null, [run, snapshot]);
  const visible = run ? run.snapshots.slice(0, step + 1) : [];
  const events = visible.flatMap((s) => s.events || []);
  const closed = events.filter((e) => e.type === "EXIT");
  const wins = closed.filter((e) => (e.realizedPnl || 0) > 0).length;
  const highWater = visible.reduce((p, v) => Math.max(p, v.equity), visible[0]?.equity || 1);
  const maxDd = visible.reduce((r, v) => {
    const peak = Math.max(r.peak, v.equity);
    return { peak, dd: Math.min(r.dd, 100 * (v.equity / peak - 1)) };
  }, { peak: visible[0]?.equity || 1, dd: 0 }).dd;

  const loadRun = (r: BtPortfolioRun, autoPlay = false) => {
    setRun(parseBtPortfolioRun(r)); setStep(0); setSelectedEvent(null); setError("");
    setPlaying(autoPlay); setTab("play");
  };
  const start = () => {
    try {
      if (mode === "REAL_BT") {
        if (!run || run.mode !== "REAL_BT") throw Error("正規BT台帳JSONを読み込んでください。HPから本番Runnerは起動しません。");
        loadRun(run, true);
      } else {
        if (!Number.isSafeInteger(Number(seed)) || !Number.isFinite(Number(initial))) throw Error("シード値と初期資金を確認してください。");
        loadRun(createBtUiDemo({ seed: Number(seed), initialEquity: Number(initial), logics, symbols, limits: DEFAULT_LIMITS }), true);
      }
    } catch (e) { setError(String(e)); }
  };
  const importFile = async (f?: File) => {
    if (!f) return;
    setPlaying(false);
    try {
      if (f.size > 25 * 1024 * 1024) throw Error("25MBより大きなデータは専用取込APIが必要です");
      const r = parseBtPortfolioRun(JSON.parse(await f.text()));
      setMode(r.mode === "REAL_BT" ? "REAL_BT" : "UI_DEMO");
      setLogics(Object.keys(r.logicPins));
      setSymbols(Array.from(new Set(r.snapshots.flatMap((s) => s.positions.map((p) => p.symbol)))));
      loadRun(r);
    } catch (e) { setError("読込失敗: " + String(e)); }
    if (fileRef.current) fileRef.current.value = "";
  };
  const save = () => {
    if (!run) return;
    const next = [{ key: String(Date.now()), label: saveName.trim() || run.runId, run }, ...saved].slice(0, 5);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); setSaved(next); setError(""); }
    catch { setError("ブラウザー保存容量が不足しています。ZIPで保存してください。"); }
  };
  const exportResult = (type: "JSON" | "CSV" | "ZIP") => {
    if (!run) return;
    const files = btExportFiles(run);
    const name = run.runId.replace(/[^a-zA-Z0-9_-]/g, "_");
    if (type === "JSON") saveDownload(name + ".json", JSON.stringify(run, null, 2), "application/json");
    if (type === "CSV") saveDownload(name + "_portfolio.csv", files.find((f) => f.name === "portfolio_timeline.csv")!.data, "text/csv");
    if (type === "ZIP") saveDownload(name + ".zip", btZip(files), "application/zip");
  };
  const seek = (v: number) => {
    if (!run) return;
    setPlaying(false); setStep(Math.max(0, Math.min(run.snapshots.length - 1, v)));
  };

  return <div className="space-y-4 text-white">
    <header className="rounded-2xl border border-[#27617c] bg-[linear-gradient(130deg,#071d30,#08121d)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-2xl font-extrabold"><FlaskConical className="text-teal-300" /> BT検証ページ</h1>
          <p className="mt-2 text-xs text-slate-400">条件設定 → 取引再生・ポートフォリオ・Gross → 結果保存・エクスポート</p></div>
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-200">
          {run?.mode === "REAL_BT" ? "正規BTデータ再生（読取専用）" : "表示デモ：取引・損益は仮想例"}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {([["setup", "条件設定"], ["play", "BT再生・ポートフォリオ"], ["report", "保存・エクスポート"]] as const).map(([id, label]) =>
          <button key={id} onClick={() => setTab(id)} className={tab === id ? "rounded-lg bg-teal-500 px-4 py-2 text-sm font-bold text-[#052028]" : action}>{label}</button>)}
      </div>
    </header>
    {error && <div role="alert" className="rounded-xl border border-rose-500/50 bg-rose-950/40 p-3 text-xs text-rose-200">{error}</div>}
    {tab === "setup" && <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
      <section className={panel + " space-y-4"}>
        <h2 className="text-lg font-bold">検証条件</h2>
        <div className="flex flex-wrap gap-2">
          <button className={mode === "UI_DEMO" ? "rounded-lg bg-teal-500 px-4 py-2 text-xs font-bold text-black" : action} onClick={() => setMode("UI_DEMO")}>操作デモ</button>
          <button className={mode === "REAL_BT" ? "rounded-lg bg-teal-500 px-4 py-2 text-xs font-bold text-black" : action} onClick={() => setMode("REAL_BT")}>正規BT台帳を再生</button>
        </div>
        <p className="text-xs leading-5 text-slate-400">デモの発火・損益は人工的な画面確認用です。正規BTは最新の検証済み台帳をインポートし、実行エンジンの判定結果だけを再生します。</p>
        <div className="space-y-2"><p className="text-sm font-semibold">ロジック（プルダウンで追加・×で削除）</p>
          <div className="flex flex-wrap gap-2">{logics.map((x) => <button key={x} className="rounded-lg border border-[#365878] bg-[#123049] px-3 py-1.5 text-xs" onClick={() => setLogics(logics.filter((v) => v !== x))}>{x} ×</button>)}</div>
          <select aria-label="ロジックを追加" className="w-full rounded-lg border border-[#35516d] bg-[#0e2538] p-2 text-xs" value="" onChange={(e) => { if (e.target.value) setLogics([...logics, e.target.value]); }}>
            <option value="">＋ ロジックを追加</option>{LOGICS.filter((x) => !logics.includes(x)).map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div className="space-y-2"><p className="text-sm font-semibold">通貨・銘柄（プルダウンで追加・×で削除）</p>
          <div className="flex flex-wrap gap-2">{symbols.map((x) => <button key={x} className="rounded-lg border border-[#365878] bg-[#123049] px-3 py-1.5 text-xs" onClick={() => setSymbols(symbols.filter((v) => v !== x))}>{x} ×</button>)}</div>
          <select aria-label="通貨を追加" className="w-full rounded-lg border border-[#35516d] bg-[#0e2538] p-2 text-xs" value="" onChange={(e) => { if (e.target.value) setSymbols([...symbols, e.target.value]); }}>
            <option value="">＋ 通貨・銘柄を追加</option>{SYMBOLS.filter((x) => !symbols.includes(x)).map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs">シード値<input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} className="mt-1 w-full rounded-lg border border-[#35516d] bg-[#0e2538] p-2" /></label>
          <label className="text-xs">初期資金<input type="number" min="1" value={initial} onChange={(e) => setInitial(e.target.value)} className="mt-1 w-full rounded-lg border border-[#35516d] bg-[#0e2538] p-2" /></label>
          <label className="text-xs">再生速度<select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-[#35516d] bg-[#0e2538] p-2">{[1, 5, 20].map((n) => <option key={n} value={n}>{n}x</option>)}</select></label>
        </div>
        <p className="text-xs text-amber-300">デモは180時間分、Gross上限 Total 3.50x / Crypto 3.00x / Stock 1.50x。正規BTでは台帳の上限・時間範囲を使用します。</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={start} className="flex items-center gap-2 rounded-xl bg-teal-500 px-5 py-3 text-sm font-bold text-[#06212a] hover:bg-teal-400"><Play size={17} /> {mode === "UI_DEMO" ? "デモBT開始" : "読込済みBT再生"}</button>
          <button className={action} onClick={() => fileRef.current?.click()}><Upload size={14} className="mr-1 inline" />正規BT台帳JSONを読込</button>
          <input type="file" accept=".json,application/json" className="hidden" ref={fileRef} onChange={(e) => void importFile(e.target.files?.[0])} />
        </div>
      </section>
      <section className={panel + " space-y-3"}>
        <h2 className="text-lg font-bold">最新ロジックの登録状況</h2>
        <p className="text-xs leading-5 text-slate-400">ロジック名は選択候補です。現行SHAの自動登録は未連携のため、正規BT台帳のpinを読み込んで初めて実際のロジックバージョンとして扱います。</p>
        {logics.map((x) => <div key={x} className="flex justify-between gap-2 rounded-lg bg-[#102b41] p-3 text-xs"><b className="text-sky-300">{x}</b><span className="max-w-[68%] truncate font-mono text-slate-300">{run?.logicPins[x] || "正式pin未読込"}</span></div>)}
        <p className="rounded-xl border border-[#38546c] p-3 text-xs text-amber-200">実BTと人工データBTを混同しません。LIVE注文・STOP・Kill Switch・本番リスク状態には一切アクセスしない独立画面です。</p>
      </section>
    </div>}
    {tab === "play" && (!run || !snapshot || !gross ? <section className={panel}>条件設定から開始するか、正規BT台帳を読み込んでください。</section> :
      <div className="space-y-4">
        <section className={panel}>
          <div className="flex flex-wrap items-center gap-2">
            <button className={action} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={14} className="mr-1 inline" /> : <Play size={14} className="mr-1 inline" />}{playing ? "一時停止" : "再開"}</button>
            <button className={action} onClick={() => { seek(0); setSelectedEvent(null); }}><RotateCcw size={14} className="mr-1 inline" />先頭へ</button>
            <label className="text-xs">速度 <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="rounded-lg border border-[#35516d] bg-[#0e2538] p-2">{[1, 5, 20].map((v) => <option key={v} value={v}>{v}x</option>)}</select></label>
            <span className="ml-auto text-xs text-slate-300">仮想時刻 {fmtDate(snapshot.timestamp)} / {step + 1} / {run.snapshots.length}</span>
          </div>
          <input aria-label="再生時点" type="range" min="0" max={run.snapshots.length - 1} value={step} onChange={(e) => seek(Number(e.target.value))} className="mt-3 w-full accent-teal-400" />
        </section>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {([
            ["Equity", money(snapshot.equity, run.currency), ""],
            ["確定損益", money(snapshot.realizedPnl, run.currency), tone(snapshot.realizedPnl)],
            ["含み損益", money(snapshot.unrealizedPnl, run.currency), tone(snapshot.unrealizedPnl)],
            ["現在DD", fixed(Math.min(0, 100 * (snapshot.equity / highWater - 1))) + "%", "text-rose-300"],
            ["最大DD", fixed(maxDd) + "%", "text-rose-300"],
            ["勝率", closed.length ? fixed(100 * wins / closed.length, 1) + "%" : "—", "text-teal-300"],
          ] as string[][]).map(([label, value, style]) => <div key={label} className={panel}><p className="text-xs text-slate-400">{label}</p><p className={"mt-2 break-all text-lg font-bold " + style}>{value}</p></div>)}
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <section className={panel}><h2 className="mb-2 font-bold">BTC代表チャート / 発火・決済マーカー</h2><HistoryChart data={run.snapshots} index={step} field="btcPrice" click={seek} /><p className="text-xs text-slate-400">青：発火、緑：利益決済、赤：損失決済。実際の通貨はイベント一覧から確認できます。</p></section>
          <section className={panel + " space-y-4"}>
            <h2 className="text-lg font-bold">Gross使用状況（実数主・割合補助）</h2>
            <GrossMeter label="Total Gross" used={gross.totalX} limit={gross.limits.totalX} lines={gross.lines} />
            <GrossMeter label="Crypto Gross" used={gross.cryptoX} limit={gross.limits.cryptoX} lines={gross.lines.filter((x) => x.assetClass === "crypto")} />
            <GrossMeter label="Stock Gross" used={gross.stockX} limit={gross.limits.stockX} lines={gross.lines.filter((x) => x.assetClass === "stock")} />
            <div className="grid grid-cols-3 rounded-lg bg-[#112a40] p-3 text-center text-xs">
              <span>残余 Total<b className="block text-lg text-teal-300">{fixed(gross.remainingTotalX)}x</b></span>
              <span>Crypto<b className="block text-lg text-teal-300">{fixed(gross.remainingCryptoX)}x</b></span>
              <span>Stock<b className="block text-lg text-teal-300">{fixed(gross.remainingStockX)}x</b></span>
            </div>
            {gross.overLimit && <p className="text-sm font-bold text-rose-400">Gross上限超過！ 原本の会計・建玉を監査してください</p>}
            <div className="flex flex-wrap gap-2">{gross.lines.map((g, i) => <span key={g.kind + g.id} className="rounded-lg border border-[#395268] px-2 py-1 text-xs"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />{g.logic}/{g.symbol} {fixed(g.grossX)}x ({fixed(g.ofUsedPercent, 1)}%)</span>)}</div>
          </section>
        </div>
        <section className={panel}>
          <h2 className="mb-3 text-lg font-bold">保有ポートフォリオ — 建玉別Gross占有率と価格・数量</h2>
          <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left text-xs">
            <thead className="border-b border-[#2c4a62] text-slate-400"><tr>{["ロジック", "銘柄", "方向", "数量", "Entry", "現在値", "想定元本", "Gross", "使用中比", "全体上限比", "含み損益", "STOP / TP"].map((h) => <th className="p-2" key={h}>{h}</th>)}</tr></thead>
            <tbody>{snapshot.positions.map((p) => { const g = gross.lines.find((x) => x.kind === "POSITION" && x.id === p.id); return <tr key={p.id} className="border-b border-[#1d3146]">
              <td className="p-2 font-semibold text-sky-300">{p.logic}</td><td className="p-2">{p.symbol}</td><td className={"p-2 " + (p.side === "LONG" ? "text-emerald-400" : "text-rose-400")}>{p.side}</td>
              <td className="p-2">{fixed(p.quantity, 6)}</td><td className="p-2">{fixed(p.entryPrice, 5)}</td><td className="p-2">{fixed(p.markPrice, 5)}</td>
              <td className="p-2">{g ? fixed(g.notional) : "—"}</td><td className="p-2 text-teal-300">{g ? fixed(g.grossX) + "x" : "—"}</td>
              <td className="p-2">{g ? fixed(g.ofUsedPercent, 1) + "%" : "—"}</td><td className="p-2">{g ? fixed(g.ofTotalLimitPercent, 1) + "%" : "—"}</td>
              <td className={"p-2 " + tone(p.unrealizedPnl || 0)}>{p.unrealizedPnl == null ? "—" : money(p.unrealizedPnl, run.currency)}</td>
              <td className="p-2">{p.stopPrice == null ? "—" : fixed(p.stopPrice, 4)} / {p.takeProfitPrice == null ? "—" : fixed(p.takeProfitPrice, 4)}</td>
            </tr>; })}
            {!snapshot.positions.length && <tr><td colSpan={12} className="p-4 text-center text-slate-400">この時点では保有建玉なし</td></tr>}</tbody>
          </table></div>
        </section>
        <div className="grid gap-4 xl:grid-cols-2">
          <section className={panel}><h2 className="mb-2 font-bold">エクイティカーブ（資産の増減）</h2><HistoryChart data={run.snapshots} index={step} field="equity" /></section>
          <section className={panel + " space-y-2"}><h2 className="font-bold">発火・決済イベント</h2>
            <div className="max-h-56 space-y-1.5 overflow-y-auto">{events.slice(-40).reverse().map((e) =>
              <button key={e.id} className="w-full rounded-lg border border-[#284964] bg-[#0d2538] p-2 text-left text-xs" onClick={() => { const idx = run.snapshots.findIndex((s) => s.timestamp === e.timestamp); if (idx >= 0) seek(idx); setSelectedEvent(e); }}>
                <span className="text-slate-400">{fmtDate(e.timestamp)} </span><b className="text-sky-300">{e.logic}</b> / {e.symbol} / {e.side} / {e.type}
                {e.realizedPnl != null && <span className={"ml-1 " + tone(e.realizedPnl)}>{money(e.realizedPnl, run.currency)}</span>}
              </button>)}
              {!events.length && <p className="p-2 text-xs text-slate-400">イベント発生待ち</p>}
            </div>
            {selectedEvent && <div className="rounded-lg bg-[#162c43] p-3 text-xs">
              <b>{selectedEvent.logic} / {selectedEvent.symbol}</b><p className="mt-1">理由：{selectedEvent.reason || "台帳未収録"}</p>
              <p>数量：{selectedEvent.quantity == null ? "—" : fixed(selectedEvent.quantity, 6)} / 価格：{selectedEvent.price == null ? "—" : fixed(selectedEvent.price, 5)}</p>
              <p>この時点の総Gross：{fixed(gross.totalX)} / {fixed(run.limits.totalX)}x</p>
            </div>}
          </section>
        </div>
      </div>)}
    {tab === "report" && <div className="grid gap-4 xl:grid-cols-2">
      <section className={panel + " space-y-3"}><h2 className="text-lg font-bold">保存済みBT・再生</h2>
        <p className="text-xs text-slate-400">保存はブラウザー内限定です。永続保存にはZIPもダウンロードしてください。</p>
        <div className="flex flex-wrap gap-2"><input value={saveName} onChange={(e) => setSaveName(e.target.value)} className="rounded-lg border border-[#35516d] bg-[#0e2538] p-2 text-xs" placeholder="保存名（任意）" />
          <button disabled={!run} className={action} onClick={save}><Save size={14} className="mr-1 inline" />保存</button></div>
        {saved.map((s) => <div key={s.key} className="flex items-center justify-between gap-2 rounded-lg bg-[#12293b] p-3 text-xs"><span>{s.label} <small className="text-slate-400">({s.run.mode})</small></span><button className={action} onClick={() => loadRun(s.run)}>再読込・再生</button></div>)}
        {!saved.length && <p className="text-xs text-slate-400">保存済みデータなし</p>}
      </section>
      <section className={panel + " space-y-3"}><h2 className="text-lg font-bold">GPT / Codex 分析用エクスポート</h2>
        <p className="text-xs text-slate-400">イベント台帳・ポートフォリオ・Gross時系列・ロジックpin・Engine SHAをまとめて出力。</p>
        <div className="flex flex-wrap gap-2">{(["JSON", "CSV", "ZIP"] as const).map((t) => <button key={t} disabled={!run} className={action} onClick={() => exportResult(t)}><Download className="mr-1 inline h-4 w-4" />{t}を出力</button>)}</div>
        <p className="text-xs leading-5 text-teal-200">ZIP：run.json / manifest.json / logic_versions.json / event_ledger.json / portfolio_snapshots.json / portfolio_timeline.csv / gross_usage_timeline.csv / trades.csv</p>
        {run && <div className="space-y-1 text-xs text-slate-400"><p>Run ID：{run.runId}</p><p>Engine SHA：{run.engineSha}</p><p>Mode：{run.mode}</p><p>Seed：{run.seed ?? "—"}</p><p>ロジック：{Object.keys(run.logicPins).join(" / ")}</p></div>}
      </section>
    </div>}
    <p className="rounded-xl border border-[#31526b] bg-[#0a1928] p-3 text-xs text-slate-400">BT専用の読取・再生ページです。本番のLIVE注文・建玉・STOP・Kill Switchを操作しません。デモの数値は実績ではなく、改善判断に利用できません。</p>
  </div>;
}
