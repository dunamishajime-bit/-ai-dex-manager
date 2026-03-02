// AUTO_CONTINUE: enabled
export type DailyTradePlanPhase = "ELAPSED" | "IN_PROGRESS" | "UPCOMING";

export interface DailyTradePlanCycle {
  key: "0-6" | "6-12" | "12-18" | "18-24";
  label: string;
  phase: DailyTradePlanPhase;
  plannedTrades: number;
  targetPairs: string[];
  timeframePlan: { timeframe: string; objective: string; trigger: string }[];
  technical: string[];
  fundamental: string[];
  sentiment: string[];
  security: string[];
  longSpan: string[];
  business: string[];
  aiAssignments: { agentName: string; task: string }[];
  riskHedge: string[];
}

export interface DailyTradePlan {
  dateJst: string;
  loginAtJst: string;
  notes: string[];
  cycles: DailyTradePlanCycle[];
}

export interface DailyTradePlanPipelineLike {
  baseToken?: string;
  targetToken?: string;
  isActive?: boolean;
}

export interface DailyTradePlanNewsLike {
  title?: string;
  source?: string;
  link?: string;
}

const PLAN_BLOCKS = [
  { key: "0-6" as const, label: "0:00-6:00", start: 0, end: 6 },
  { key: "6-12" as const, label: "6:00-12:00", start: 6, end: 12 },
  { key: "12-18" as const, label: "12:00-18:00", start: 12, end: 18 },
  { key: "18-24" as const, label: "18:00-24:00", start: 18, end: 24 },
];

function getJstNow(date = new Date()): Date {
  return new Date(date.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
}

function toYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toHm(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function normalizeSymbol(symbol: string | undefined, fallback = "BNB"): string {
  const upper = String(symbol || fallback).trim().toUpperCase();
  if (upper === "MATIC") return "POL";
  if (upper === "ASTR") return "ASTER";
  return upper;
}

function buildPair(base: string, quote: string): string {
  return `${normalizeSymbol(base)}-${normalizeSymbol(quote)}`;
}

function getDefaultPairs(chainId?: number): string[] {
  if (chainId === 137) {
    return [
      buildPair("POL", "USDT"),
      buildPair("POL", "USDC"),
      buildPair("ETH", "USDT"),
      buildPair("LINK", "USDT"),
    ];
  }

  return [
    buildPair("BNB", "LINK"),
    buildPair("BNB", "WLFI"),
    buildPair("ASTER", "BNB"),
    buildPair("CAKE", "BNB"),
    buildPair("SHIB", "BNB"),
  ];
}

function getPhase(hour: number, start: number, end: number): DailyTradePlanPhase {
  if (hour >= end) return "ELAPSED";
  if (hour >= start) return "IN_PROGRESS";
  return "UPCOMING";
}

export function getCurrentCycleKey(date = new Date()): DailyTradePlanCycle["key"] {
  const hour = getJstNow(date).getHours();
  if (hour < 6) return "0-6";
  if (hour < 12) return "6-12";
  if (hour < 18) return "12-18";
  return "18-24";
}

export function getCurrentPlanCycle(
  plan: DailyTradePlan | null,
  date = new Date(),
): DailyTradePlanCycle | null {
  if (!plan) return null;
  const key = getCurrentCycleKey(date);
  return plan.cycles.find((cycle) => cycle.key === key) ?? null;
}

export function extractTradeSymbolsFromPlanCycle(cycle: DailyTradePlanCycle | null): string[] {
  if (!cycle) return [];

  return Array.from(
    new Set(
      cycle.targetPairs
        .flatMap((pair) => pair.split("-"))
        .map((symbol) => normalizeSymbol(symbol))
        .filter(Boolean),
    ),
  );
}

function buildCycleNews(latestNews: DailyTradePlanNewsLike | null | undefined, phase: DailyTradePlanPhase): string {
  if (phase === "IN_PROGRESS" && latestNews?.title) {
    return `${latestNews.source || "ニュース"}: ${latestNews.title}`;
  }
  return "このサイクルではニュースは補助要因に留め、主軸は短期足の方向性と出来高の変化で判断します。";
}

export function buildDailyTradePlan(options: {
  selectedCurrency: string;
  pipelines?: DailyTradePlanPipelineLike[];
  latestNews?: DailyTradePlanNewsLike | null;
  chainId?: number;
  now?: Date;
}): DailyTradePlan {
  const jst = getJstNow(options.now);
  const currentHour = jst.getHours();
  const selected = normalizeSymbol(options.selectedCurrency);
  const defaultPairs = getDefaultPairs(options.chainId);
  const pipelinePairs = (options.pipelines || [])
    .filter((pipeline) => pipeline?.isActive && pipeline?.baseToken && pipeline?.targetToken)
    .map((pipeline) => buildPair(String(pipeline.baseToken), String(pipeline.targetToken)));
  const pairPool = Array.from(new Set([...pipelinePairs, ...defaultPairs]));
  const normalizedPool = pairPool.length > 0 ? pairPool : defaultPairs;

  const cycles = PLAN_BLOCKS.map((block, index): DailyTradePlanCycle => {
    const phase = getPhase(currentHour, block.start, block.end);
    const pairA = normalizedPool[index % normalizedPool.length] || buildPair("BNB", "LINK");
    const pairB = normalizedPool[(index + 1) % normalizedPool.length] || pairA;
    const pairC = normalizedPool[(index + 2) % normalizedPool.length] || buildPair(selected, "BNB");
    const targetPairs = Array.from(new Set([pairA, pairB, pairC]));
    const cycleNews = buildCycleNews(options.latestNews, phase);

    return {
      key: block.key,
      label: block.label,
      phase,
      plannedTrades: phase === "ELAPSED" ? 0 : 24,
      targetPairs,
      timeframePlan: [
        {
          timeframe: "1分足",
          objective: `${targetPairs[0]} の超短期モメンタムと出来高の急増を監視する`,
          trigger: "VWAP の上で推移し、直近高値を更新しながら出来高が増えた時だけ入る",
        },
        {
          timeframe: "3分足",
          objective: `${targetPairs[0]} の押し目継続か失速かを判定する`,
          trigger: "1分足の勢いが続き、3分足でも高値切り上げが確認できる時だけ買う",
        },
        {
          timeframe: "5分足",
          objective: `${targetPairs[1]} の方向感を確定する`,
          trigger: "5分足の高値安値が揃って上向きなら順張り、崩れたら見送る",
        },
        {
          timeframe: "15分足",
          objective: `${targetPairs[2]} の逆行リスクを確認する`,
          trigger: "15分足で戻り売りが強い時は追いかけず、押し目待ちへ切り替える",
        },
      ],
      technical: [
        `${targetPairs[0]} は 1分足と3分足が同方向に揃うまで待ち、早すぎる飛び乗りを避ける`,
        `${targetPairs[1]} は 5分足の失速が出た時点で追撃を止め、利確を優先する`,
      ],
      fundamental: [
        cycleNews,
        `${targetPairs[0]} と ${targetPairs[1]} は最新ニュースの強弱より、短期足の出来高反応を優先する`,
      ],
      sentiment: [
        `${targetPairs[1]} は SNS の過熱感が強い時ほど飛びつかず、反応後の押しを待つ`,
        "著名アカウントの投稿は補助要因として扱い、価格と出来高が伴わない時は無視する",
      ],
      security: [
        "大口送金、コントラクト異常、ブリッジ障害が出たら短期シグナルより先にリスク縮小を優先する",
        "短時間で異常な板薄や急変が出た場合は、追加エントリーを止める",
      ],
      longSpan: [
        "6時間足と24時間足の方向が逆行している時は、短期利確を早めてポジションを軽くする",
        "ニュースで地合いが崩れた場合は、そのサイクルの取引ペース自体を落とす",
      ],
      business: [
        `${targetPairs[0]} は事業性より流動性と交換効率を確認し、滑りやすい時間帯は避ける`,
        "プロジェクト評価は補助材料であり、評価だけで飛びつかない",
      ],
      aiAssignments: [
        { agentName: "テクニカル", task: `${targetPairs[0]} の 1分足・3分足・5分足で買い条件と失速条件を更新する` },
        { agentName: "ファンダメンタル", task: `${targetPairs[1]} に関するニュースと事業進捗の強弱を整理する` },
        { agentName: "セキュリティ", task: "大口移動、コントラクト障害、ブリッジ異常の有無を監視する" },
      ],
      riskHedge: [
        "1回のエントリーは最大3分割とし、同一方向へ一度に全額を入れない",
        "ガス確保のため BNB を一定額残し、ガス不足が近い時は新規エントリーを止める",
        "15分足で方向が崩れたら、利確未達でも出来高優先で撤退する",
      ],
    };
  });

  return {
    dateJst: toYmd(jst),
    loginAtJst: toHm(jst),
    notes: [
      "この計画はログイン時点の日本時間を基準に、当日サイクルを整理したものです。",
      "各サイクルの主軸は 1分足・3分足・5分足の短期判断で、ニュースは補助材料として扱います。",
      "利確と損切りは固定ではなく、市場の失速やニュース、リスクイベントに応じて調整します。",
    ],
    cycles,
  };
}
