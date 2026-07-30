"use client";

import { useAuth } from "@/context/AuthContext";
import { DIST_TERMINAL_LIVE_CONFIG } from "@/lib/disterminal-live-config";
import { SITE_BRAND_NAME } from "@/lib/site-access";

function Status({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/55">{label}</div>
      <div className="mt-1 text-sm font-bold text-white">{value}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const maskedEmail = user?.email ? user.email.replace(/^(.{2}).*(@.*)$/, "$1•••$2") : "未確認";

  return (
    <main className="mx-auto w-full max-w-5xl space-y-4">
      <section className="rounded-[28px] border border-gold-400/16 bg-[#03050a] p-5 md:p-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/70">{SITE_BRAND_NAME}</p>
        <h1 className="mt-2 text-3xl font-black text-white">設定・運用確認</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-white/70">
          このページは現在の運用設定と認証状態の確認専用です。注文、決済、LIVE設定、リスク設定はここから変更できません。
        </p>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <Status label="構成" value={DIST_TERMINAL_LIVE_CONFIG.strategyLabel} />
        <Status label="取引所・Executor" value={`${DIST_TERMINAL_LIVE_CONFIG.executionVenue} / ${DIST_TERMINAL_LIVE_CONFIG.executor}`} />
        <Status label="V96 Daily Loss" value={`${DIST_TERMINAL_LIVE_CONFIG.v96DailyLossPct}%`} />
        <Status label="V52 Daily Loss" value={`${DIST_TERMINAL_LIVE_CONFIG.v52DailyLossPct}%`} />
        <Status label="Portfolio最大Gross" value={String(DIST_TERMINAL_LIVE_CONFIG.maximumGross)} />
        <Status label="PENGU初期Gross" value={String(DIST_TERMINAL_LIVE_CONFIG.penguInitialGross)} />
        <Status label="承認対象SHA" value={DIST_TERMINAL_LIVE_CONFIG.approvedReleaseSha} />
        <Status label="LIVEサービス" value="未確認（VPS状態を直接取得できないため）" />
      </section>

      <section className="rounded-[28px] border border-white/10 bg-[#080c12] p-5">
        <h2 className="text-lg font-black text-white">ログイン状態</h2>
        <p className="mt-2 text-sm text-white/70">メールアドレス: {maskedEmail}</p>
        <p className="mt-2 text-xs leading-6 text-white/55">認証情報や秘密鍵は表示しません。ログアウト以外の認証設定変更は管理画面で行ってください。</p>
        <button type="button" onClick={logout} className="mt-4 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/[0.06]">ログアウト</button>
      </section>
    </main>
  );
}
