import { V12V4RuntimePanel } from "@/components/features/V12V4RuntimePanel";

export default function V12DecisionPage() {
  return <main className="space-y-4 p-4 md:p-6"><header className="panel-gold rounded-[28px] p-5 md:p-7"><div className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-100/70">Decision monitor / V12 V4</div><h1 className="gold-heading mt-2 text-3xl font-black">V12 V4 判定状況</h1><p className="mt-3 text-sm leading-7 text-white/75">V4専用の読み取り状態、候補route、実runner SHA・primary mode・freshnessを表示します。旧V12 decision snapshotへフォールバックしません。V4 native scoreはデータ源に存在しない場合「未提供」とし、捏造しません。</p></header><V12V4RuntimePanel /></main>;
}
