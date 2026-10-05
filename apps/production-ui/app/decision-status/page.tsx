import Link from "next/link";
import { ArrowRight, Route, ShieldCheck } from "lucide-react";

import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

export default function DecisionStatusPage() {
  return (
    <main className="space-y-4 p-4 md:p-6">
      <header className="panel-gold rounded-[28px] p-5 md:p-7">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-100/70">Read-only LIVE decision monitor</div>
        <h1 className="gold-heading mt-2 text-3xl font-black">判定状況</h1>
        <p className="mt-3 max-w-4xl text-sm leading-7 text-white/75">
          V12 / PENGU / FET / Q102 / V52 / HYPE の従来LIVEデータを維持しながら、
          Idle Priority / Formal Priority の新ロジック状態も確認できます。
        </p>
      </header>

      <DecisionStatusPanel logic="overview" />

      <section className="grid gap-3 md:grid-cols-2">
        <Link href="/decision-status/idle-priority" className="panel-gold group rounded-[24px] p-4 transition hover:-translate-y-0.5 hover:border-gold-300/40">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xl font-black">
                <Route className="h-5 w-5 text-gold-100" />
                Idle Priority
              </div>
              <p className="mt-2 text-xs leading-5 text-white/60">
                Idle SHORT / residual LONG の現在状態、heartbeat、baseline、state、decision detailsを表示します。
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-gold-100/70 transition group-hover:translate-x-0.5" />
          </div>
        </Link>

        <Link href="/decision-status/formal-priority" className="panel-gold group rounded-[24px] p-4 transition hover:-translate-y-0.5 hover:border-gold-300/40">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xl font-black">
                <ShieldCheck className="h-5 w-5 text-gold-100" />
                Formal Priority
              </div>
              <p className="mt-2 text-xs leading-5 text-white/60">
                V12 sizing / Q102 handoff / actual-exit + 2h cooldown と現在stateを表示します。
              </p>
            </div>
            <ArrowRight className="h-4 w-4 text-gold-100/70 transition group-hover:translate-x-0.5" />
          </div>
        </Link>
      </section>
    </main>
  );
}
