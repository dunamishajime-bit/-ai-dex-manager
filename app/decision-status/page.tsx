import { DecisionStatusPanel } from "@/components/features/DecisionStatusPanel";

const TEXT = {
  title: "\u5224\u5b9a\u72b6\u6cc1",
  description: "V96 Crypto\u3068V52 Stock\u306e\u5b9fLIVE Runner\u304c\u51fa\u529b\u3059\u308b\u6700\u65b0\u5224\u5b9a\u30b9\u30ca\u30c3\u30d7\u30b7\u30e7\u30c3\u30c8\u3092\u8aad\u307f\u53d6\u308a\u8868\u793a\u3057\u307e\u3059\u3002\u5b9fLIVE Runner\u306e\u6761\u4ef6\u30fb\u30ea\u30b9\u30afGate\u30fb\u6ce8\u6587\u8a31\u53ef\u72b6\u614b\u3068\u4e00\u81f4\u3057\u306a\u3044\u5834\u5408\u306f\u767a\u706b\u5019\u88dc\u306b\u3057\u307e\u305b\u3093\u3002\u3053\u3053\u304b\u3089\u6ce8\u6587\u30fb\u53d6\u6d88\u30fb\u5efa\u7389\u5909\u66f4\u306f\u884c\u3044\u307e\u305b\u3093\u3002",
} as const;

export default function DecisionStatusPage() {
  return (
    <main className="space-y-4 p-4 md:p-6">
      <header className="panel-gold rounded-[28px] p-5 md:p-7">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-100/70">Read-only decision monitor</div>
        <h1 className="gold-heading mt-2 text-3xl font-black">{TEXT.title}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-white/75">{TEXT.description}</p>
      </header>
      <DecisionStatusPanel />
    </main>
  );
}