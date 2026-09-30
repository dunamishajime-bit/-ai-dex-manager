import { IdlePriorityDecisionPanel } from "@/components/features/IdlePriorityDecisionPanel";

export default function IdlePriorityDecisionPage() {
  return <main className="min-w-0 space-y-5 overflow-x-hidden p-3 sm:p-4 md:p-6">
    <header className="panel-gold rounded-[28px] p-4 md:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-gold-100/70">Read-only Production / IDLE_PRIORITY_SHORT</p>
      <h1 className="gold-heading mt-2 text-2xl font-black md:text-3xl">Idle Priority 発火判定・稼働状態</h1>
      <p className="mt-3 text-sm leading-6 text-white/70">
        TAO / TIA / DOT / JUP / RENDER のIdle SHORTを、実runtime SHA・heartbeat・state・Kill Switch・pending・保護注文状態までread-only表示します。
      </p>
    </header>
    <IdlePriorityDecisionPanel />
  </main>;
}
