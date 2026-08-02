import Link from "next/link";

const TEXT = {
  title: "\u30da\u30fc\u30b8\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093",
  description: "\u6307\u5b9a\u3055\u308c\u305f\u30da\u30fc\u30b8\u306f\u5b58\u5728\u3057\u306a\u3044\u304b\u3001\u79fb\u52d5\u3057\u305f\u53ef\u80fd\u6027\u304c\u3042\u308a\u307e\u3059\u3002\u30db\u30fc\u30e0\u306b\u623b\u3063\u3066\u7d9a\u3051\u3066\u304f\u3060\u3055\u3044\u3002",
  home: "\u30db\u30fc\u30e0\u3078\u623b\u308b",
} as const;

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#03060b] px-4 text-white">
      <div className="panel-gold max-w-xl rounded-[28px] p-6 text-center">
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/72">Dis-DEXManager</div>
        <h1 className="mt-3 text-2xl font-black text-white">{TEXT.title}</h1>
        <p className="mt-3 text-sm leading-7 text-white/78">{TEXT.description}</p>
        <Link
          href="/"
          className="mt-5 inline-flex rounded-full border border-gold-400/30 bg-[linear-gradient(180deg,rgba(253,224,71,0.18),rgba(245,158,11,0.08))] px-4 py-2 text-sm font-semibold text-gold-50 transition hover:border-gold-300/50"
        >
          {TEXT.home}
        </Link>
      </div>
    </main>
  );
}