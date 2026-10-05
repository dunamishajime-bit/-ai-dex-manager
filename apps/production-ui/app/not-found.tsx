export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#03060b] px-4 text-white">
      <div className="panel-gold max-w-xl rounded-[28px] p-6 text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/72">Dis-DEXManager</div>
        <h1 className="mt-3 text-2xl font-black text-white">ページが見つかりません</h1>
        <p className="mt-3 text-sm leading-7 text-white/78">
          指定されたページは存在しないか、移動した可能性があります。ホームに戻って続けてください。
        </p>
        <a
          href="/"
          className="mt-5 inline-flex rounded-full border border-gold-400/30 bg-[linear-gradient(180deg,rgba(253,224,71,0.18),rgba(245,158,11,0.08))] px-4 py-2 text-sm font-semibold text-gold-50 transition hover:border-gold-300/50"
        >
          ホームへ戻る
        </a>
      </div>
    </main>
  );
}
