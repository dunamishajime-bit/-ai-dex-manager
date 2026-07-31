import type { ReactNode } from "react";

export function formatUsd(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "取得不能";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value);
}

export function DataCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55">{label}</div>
      <div className="mt-2 text-xl font-black text-white">{value}</div>
      {detail ? <div className="mt-1 text-[11px] text-white/55">{detail}</div> : null}
    </div>
  );
}

export function ReadOnlyNotice({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" | "success" }) {
  const toneClass =
    tone === "warning"
      ? "border-amber-400/25 bg-amber-500/10 text-amber-100"
      : tone === "success"
        ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
        : "border-white/10 bg-white/[0.03] text-white/70";
  return <div className={"rounded-2xl border px-4 py-3 text-sm " + toneClass}>{children}</div>;
}

export function SourceLine({ source, fetchedAt }: { source: string; fetchedAt?: string }) {
  return (
    <p className="text-[11px] text-white/50">
      Source: {source} · 最終取得: {fetchedAt ? new Date(fetchedAt).toLocaleString("ja-JP") : "未確認"}
    </p>
  );
}
