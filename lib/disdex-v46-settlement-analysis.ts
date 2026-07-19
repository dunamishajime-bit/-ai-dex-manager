import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { DisDexPenguV46History } from "./pengu-dual-engine-v46";

const STRATEGY_ID = "DISDEX_V35_CORE_PLUS_PENGU_DUAL_V46" as const;
const ANALYSIS_VERSION = "v1-post-settlement" as const;
const DEFAULT_FEE_BPS_PER_SIDE = 6;

export interface DisDexV46ExecutionRecord {
    idempotencyKey: string;
    clientOrderId: string;
    orderId?: number;
    symbol: string;
    side: "BUY" | "SELL";
    reduceOnly: boolean;
    status: "FILLED" | "PARTIALLY_FILLED";
    requestedQuantity: number;
    executedQuantity: number;
    averagePrice: number;
    quoteQuantity: number;
    completedAt: number;
    referenceTs: number;
    targetWeight: number;
    reason: string;
    positionBefore?: {
        signedQuantity: number;
        entryPrice: number;
        markPrice: number;
        notionalUsd: number;
        observedAt: number;
    };
}

export type SettlementDirection = "LONG" | "SHORT" | "UNKNOWN";
export type SettlementOutcome = "PROFIT" | "LOSS" | "FLAT" | "INCOMPLETE";

export interface DisDexV46SettlementAnalysis {
    version: 1;
    analysisVersion: typeof ANALYSIS_VERSION;
    id: string;
    sourceExecutionKey: string;
    strategyId: typeof STRATEGY_ID;
    symbol: string;
    direction: SettlementDirection;
    outcome: SettlementOutcome;
    entryPrice: number | null;
    exitPrice: number | null;
    quantity: number;
    grossPnlUsd: number | null;
    feeEstimateUsd: number | null;
    netPnlEstimateUsd: number | null;
    returnPct: number | null;
    holdingMs: number | null;
    marketGranularity: "1h" | "12h" | "none";
    inTradeHigh: number | null;
    inTradeLow: number | null;
    mfePct: number | null;
    maePct: number | null;
    capturedMfePct: number | null;
    opportunityLeftPct: number | null;
    signalReason: string;
    whatWorked: string[];
    whatFailed: string[];
    moreProfitPotential: string;
    improvementProposal: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    evidence: string[];
    completedAt: string;
    generatedAt: string;
}

export interface DisDexV46SettlementAnalysisFile {
    version: 1;
    updatedAt: string;
    items: DisDexV46SettlementAnalysis[];
}

function finite(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function directionFor(record: DisDexV46ExecutionRecord): SettlementDirection {
    const signed = finite(record.positionBefore?.signedQuantity);
    if (signed > 0) return "LONG";
    if (signed < 0) return "SHORT";
    return "UNKNOWN";
}

function rowsForSymbol(history: DisDexPenguV46History, symbol: string) {
    const normalized = symbol.toUpperCase();
    if (normalized === "BTCUSDT") return { rows: history.btc1h, granularity: "1h" as const };
    if (normalized === "PENGUUSDT") return { rows: history.pengu1h, granularity: "1h" as const };
    const rows = history.core12h[normalized as keyof typeof history.core12h];
    return rows ? { rows, granularity: "12h" as const } : { rows: [], granularity: "none" as const };
}

function calculatePath(record: DisDexV46ExecutionRecord, direction: SettlementDirection, history: DisDexPenguV46History) {
    const entry = finite(record.positionBefore?.entryPrice);
    const exit = finite(record.averagePrice);
    const observedAt = finite(record.positionBefore?.observedAt);
    const completedAt = finite(record.completedAt);
    const { rows, granularity } = rowsForSymbol(history, record.symbol);
    const path = rows.filter((row) => row.openTime >= observedAt && row.closeTime <= completedAt);
    const prices = [entry, exit, ...path.flatMap((row) => [row.high, row.low])].filter((value) => value > 0);
    if (!prices.length) return { granularity, high: null, low: null, mfePct: null, maePct: null };
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    if (!(entry > 0) || direction === "UNKNOWN") return { granularity, high, low, mfePct: null, maePct: null };
    const favorable = direction === "LONG" ? high : low;
    const adverse = direction === "LONG" ? low : high;
    const mfePct = direction === "LONG" ? ((favorable / entry) - 1) * 100 : ((entry / favorable) - 1) * 100;
    const maePct = direction === "LONG" ? ((adverse / entry) - 1) * 100 : ((entry / adverse) - 1) * 100;
    return { granularity, high, low, mfePct, maePct };
}

function safeReason(reason: string) {
    return reason.replace(/\s+/g, " ").trim().slice(0, 420);
}

export function analyzeDisDexV46Settlement(
    record: DisDexV46ExecutionRecord,
    history: DisDexPenguV46History,
    now = Date.now(),
): DisDexV46SettlementAnalysis | null {
    if (!record.reduceOnly || record.executedQuantity <= 0 || record.averagePrice <= 0) return null;
    const direction = directionFor(record);
    const entry = finite(record.positionBefore?.entryPrice);
    const exit = finite(record.averagePrice);
    const quantity = Math.min(Math.abs(finite(record.executedQuantity)), Math.abs(finite(record.positionBefore?.signedQuantity)) || Math.abs(finite(record.executedQuantity)));
    if (!(entry > 0) || !(exit > 0) || !(quantity > 0) || direction === "UNKNOWN") return null;

    const sign = direction === "LONG" ? 1 : -1;
    const grossPnlUsd = (exit - entry) * quantity * sign;
    const feeEstimateUsd = ((entry * quantity) + (exit * quantity)) * (DEFAULT_FEE_BPS_PER_SIDE / 10_000);
    const netPnlEstimateUsd = grossPnlUsd - feeEstimateUsd;
    const returnPct = entry > 0 ? ((exit - entry) / entry) * sign * 100 : null;
    const observedAt = finite(record.positionBefore?.observedAt);
    const completedAt = finite(record.completedAt, now);
    const holdingMs = observedAt > 0 && completedAt >= observedAt ? completedAt - observedAt : null;
    const path = calculatePath(record, direction, history);
    const opportunityLeftPct = path.mfePct == null || returnPct == null ? null : Math.max(0, path.mfePct - returnPct);
    const capturedMfePct = path.mfePct != null && path.mfePct > 0 && returnPct != null ? clamp((returnPct / path.mfePct) * 100, -100, 100) : null;
    const outcome: SettlementOutcome = netPnlEstimateUsd > 0.000001 ? "PROFIT" : netPnlEstimateUsd < -0.000001 ? "LOSS" : "FLAT";
    const evidence = [
        "Asterの実約定結果（reduce-only fill）",
        `決済理由: ${safeReason(record.reason) || "記録なし"}`,
        path.granularity === "none" ? "決済経路の市場足が取得できず、MFE/MAEは算出していない" : `${path.granularity}足の決済前経路（completed candleのみ）`,
        "手数料・Fundingは取引所のincome明細未取得のため概算。Live設定は自動変更しない",
    ];
    const whatWorked: string[] = [];
    const whatFailed: string[] = [];
    if (outcome === "PROFIT") whatWorked.push(`実約定ベースで利益を確保（概算Net ${netPnlEstimateUsd.toFixed(4)} USD）。`);
    if (outcome === "LOSS") whatFailed.push(`実約定ベースで損失となった（概算Net ${netPnlEstimateUsd.toFixed(4)} USD）。`);
    if (path.mfePct != null && path.mfePct > 0) {
        if ((capturedMfePct ?? 0) >= 70) whatWorked.push(`決済前の最大有利方向（MFE ${path.mfePct.toFixed(2)}%）の${(capturedMfePct ?? 0).toFixed(0)}%を回収。`);
        else whatFailed.push(`決済前にMFE ${path.mfePct.toFixed(2)}%があったが、回収率は${(capturedMfePct ?? 0).toFixed(0)}%。`);
    } else if (path.mfePct != null) {
        whatFailed.push("決済前に測定できる有利方向の値動きがほぼなく、入口・相場環境の改善余地が大きい。");
    }
    if (record.reason) whatWorked.push("シグナル理由と決済イベントを同一の耐久レコードへ紐付けた。");
    if (path.granularity === "12h") whatFailed.push("コア銘柄は12時間足でMFE/MAEを測定しているため、短時間のピークは過小評価の可能性がある。");

    const moreProfitPotential = opportunityLeftPct != null && opportunityLeftPct >= 0.25
        ? `可能性あり。決済前経路では最大${path.mfePct?.toFixed(2)}%まで有利に動き、実決済との差は約${opportunityLeftPct.toFixed(2)}ポイント。ただしこれは決済後の反実仮想であり、将来も再現する証明ではない。`
        : "今回の決済前経路から、統計的に意味のある追加利益余地は確認できない。サンプルを蓄積して再評価する。";
    const improvementProposal = outcome === "LOSS"
        ? (path.mfePct != null && path.mfePct >= 0.25
            ? "損失になる前のMFEを活かせる利益保護（段階利確・追従退出）を候補化し、同一データのBT/OOSで検証する。Liveロジックへ自動反映しない。"
            : "MFEが小さい損失なので、出口だけでなくEntry条件・BTCレジーム・Volume/Funding条件を分解して再検証する。Liveロジックへ自動反映しない。")
        : opportunityLeftPct != null && opportunityLeftPct >= 0.25
            ? "早過ぎる決済の可能性を候補化し、hold延長・trailing・部分利確をBT/OOSで比較する。Liveロジックへ自動反映しない。"
            : "現行の決済は概ね有効。次回以降も同じ指標で、利益を伸ばせる再現性があるかを検証する。";

    return {
        version: 1,
        analysisVersion: ANALYSIS_VERSION,
        id: `${record.idempotencyKey}:${record.completedAt}`,
        sourceExecutionKey: record.idempotencyKey,
        strategyId: STRATEGY_ID,
        symbol: record.symbol.toUpperCase(),
        direction,
        outcome,
        entryPrice: entry,
        exitPrice: exit,
        quantity,
        grossPnlUsd,
        feeEstimateUsd,
        netPnlEstimateUsd,
        returnPct,
        holdingMs,
        marketGranularity: path.granularity,
        inTradeHigh: path.high,
        inTradeLow: path.low,
        mfePct: path.mfePct,
        maePct: path.maePct,
        capturedMfePct,
        opportunityLeftPct,
        signalReason: safeReason(record.reason),
        whatWorked,
        whatFailed,
        moreProfitPotential,
        improvementProposal,
        confidence: path.granularity === "none" ? "LOW" : path.granularity === "12h" ? "MEDIUM" : "HIGH",
        evidence,
        completedAt: new Date(completedAt).toISOString(),
        generatedAt: new Date(now).toISOString(),
    };
}

function normalizeFile(value: unknown): DisDexV46SettlementAnalysisFile {
    if (!value || typeof value !== "object") return { version: 1, updatedAt: new Date(0).toISOString(), items: [] };
    const raw = value as Partial<DisDexV46SettlementAnalysisFile>;
    return {
        version: 1,
        updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
        items: Array.isArray(raw.items) ? raw.items.filter((item): item is DisDexV46SettlementAnalysis => Boolean(item && typeof item.id === "string" && typeof item.sourceExecutionKey === "string")).slice(-200) : [],
    };
}

export class FileDisDexV46SettlementAnalysisStore {
    private readonly path: string;

    constructor(filePath: string) {
        this.path = resolve(filePath);
    }

    async load(): Promise<DisDexV46SettlementAnalysisFile> {
        try {
            return normalizeFile(JSON.parse(await readFile(this.path, "utf8")) as unknown);
        } catch (error) {
            const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
            if (code === "ENOENT") return { version: 1, updatedAt: new Date(0).toISOString(), items: [] };
            throw error;
        }
    }

    async process(input: { executions: DisDexV46ExecutionRecord[]; history: DisDexPenguV46History; now?: number }) {
        const current = await this.load();
        const existing = new Set(current.items.map((item) => item.sourceExecutionKey));
        const additions = input.executions
            .filter((execution) => execution.reduceOnly && !existing.has(execution.idempotencyKey))
            .map((execution) => analyzeDisDexV46Settlement(execution, input.history, input.now));
        const items = [...current.items, ...additions.filter((item): item is DisDexV46SettlementAnalysis => item != null)].slice(-200);
        if (items.length === current.items.length) return { created: 0, latest: items.at(-1) ?? null };
        const next: DisDexV46SettlementAnalysisFile = { version: 1, updatedAt: new Date(input.now ?? Date.now()).toISOString(), items };
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, this.path);
        return { created: items.length - current.items.length, latest: items.at(-1) ?? null };
    }
}

