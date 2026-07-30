"use client";
import { useEffect, useMemo, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";

type Trade = { id?: string; executedAt?: string; openedAt?: string; sourceSymbol?: string; destSymbol?: string; action?: string; realizedPnlUsd?: number; realizedPnlPct?: number; provider?: string; strategy?: string; side?: string; positionSide?: string; quantity?: number; executionPrice?: number; commissionUsd?: number; fundingUsd?: number; source?: string; settled?: boolean; orderId?: string | number; tradeId?: string | number; };
type HistoryResponse = { ok?: boolean; entries?: Trade[]; accountAddress?: string; warning?: string; source?: { aster?: boolean; local?: boolean; window?: string }; fetchedAt?: string };

export default function HistoryPage() {
  const [entries, setEntries] = useState<Trade[]>([]);
  const [meta, setMeta] = useState<HistoryResponse>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/system/trade-history", { cache: "no-store" });
      const data = (await response.json()) as HistoryResponse;
      if (!response.ok || !data?.ok) throw new Error("取引履歴を取得できません。");
      setEntries(Array.isArray(data.entries) ? data.entries : []); setMeta(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "取引履歴を取得できません。"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const fills = useMemo(() => entries.filter((entry) => entry.source === "aster" || typeof entry.realizedPnlUsd === "number"), [entries]);
  return <main className="space-y-4"><header className="panel-gold rounded-[30px] p-5 md:p-7"><div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/75"><FileText className="h-4 w-4" />トレード履歴</div><h1 className="gold-heading mt-3 text-3xl font-black md:text-5xl">AsterDEX実約定履歴</h1><p className="mt-3 text-sm leading-7 text-white/75">AsterDEX USER_DATAの実約定をV96 Crypto／V52 Stockに分けて表示します。画面から注文や決済は実行できません。</p>{meta.accountAddress ? <p className="mt-2 break-all text-xs text-white/55">口座: {meta.accountAddress}</p> : null}<button type="button" onClick={() => void load()} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs"><RefreshCw className="h-4 w-4" />更新</button></header>{error ? <Notice text={error} /> : null}{meta.warning ? <Notice text={`${meta.warning}${meta.source?.window ? `（${meta.source.window}）` : ""}`} /> : null}<section className="panel-gold rounded-[30px] p-5"><div className="mb-3 flex items-center justify-between"><h2 className="font-bold">実約定 {loading ? "読込中" : `${fills.length}件`}</h2><span className="text-xs text-white/50">{meta.fetchedAt ? `取得: ${formatDate(meta.fetchedAt)}` : "実データのみ"}</span></div><div className="space-y-2">{!loading && !fills.length ? <Notice text="AsterDEXから確認できる実約定はありません。未決済Entryは損益レビューに含めません。" /> : fills.map((entry, index) => <div key={entry.id || `${entry.executedAt}-${index}`} className="grid gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-[1fr_auto_auto] md:items-center"><div><div className="font-semibold">{entry.sourceSymbol || "-"} ／ {entry.side || entry.action || "-"} {entry.positionSide ? `／${entry.positionSide}` : ""}</div><div className="text-xs text-white/50">{entry.strategy || "Strategy未分類"} ・ {entry.provider || "source未分類"}</div><div className="text-xs text-white/50">{formatDate(entry.executedAt)} {entry.orderId ? `・ order ${entry.orderId}` : ""}</div></div><div className="text-sm text-white/70">数量 {entry.quantity ?? "-"}<br />価格 {entry.executionPrice ?? "-"}<br />手数料 {money(entry.commissionUsd)}</div><div className={Number(entry.realizedPnlUsd) >= 0 ? "text-emerald-300" : "text-rose-300"}>{entry.realizedPnlUsd === undefined ? "損益未確定" : money(entry.realizedPnlUsd)}<div className="text-xs">{pct(entry.realizedPnlPct)} {entry.settled ? "決済損益" : "約定"}</div></div></div>)}</div></section></main>;
}
function formatDate(value?: string) { return value ? new Date(value).toLocaleString("ja-JP") : "-"; }
function money(value?: number) { return typeof value === "number" ? `$${value.toFixed(4)}` : "-"; }
function pct(value?: number) { return typeof value === "number" ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "-"; }
function Notice({ text }: { text: string }) { return <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-white/60">{text}</div>; }
