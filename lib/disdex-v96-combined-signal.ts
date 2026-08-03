import { DISDEX_V96_ALLOCATION, DISDEX_V96_STRATEGY_ID } from "@/config/disdexV96Runtime";
import { allocateDisDexV96ReservedPengu } from "@/lib/disdex-v96-allocation";
import {
    buildDisDexV95CoreSignal,
    type DisDexV95CoreSignal,
} from "@/lib/disdex-v95-core-signal";
import type { DisDexV35Symbol } from "@/lib/disdex-v35-signal-engine";
import {
    buildDisDexPenguV46Signal,
    type DisDexPenguV46History,
    type DisDexPenguV46Signal,
} from "@/lib/pengu-dual-engine-v46";

function legacyPenguEnabled() {
    return !/^(0|false|off|no)$/i.test(String(process.env.PENGU_LEGACY_CORE_ENABLED ?? "true").trim());
}

function buildLegacyPenguSignal(history: DisDexPenguV46History, now: number): DisDexPenguV46Signal {
    if (legacyPenguEnabled()) return buildDisDexPenguV46Signal(history, now);
    return {
        strategyId: "PENGU_DUAL_ENGINE_V46",
        side: 0,
        targetGross: 0,
        reason: "Legacy PENGU V46 is disabled; PENGU_DUAL_LS_V1 is the sole PENGU owner.",
        diagnostics: {
            evaluatedDecisionBars: 0,
            fundingCoverage: false,
            latestCompletedPenguTs: undefined,
            latestCompletedBtcTs: undefined,
        },
    };
}
export interface DisDexV96CombinedSignal {
    strategyId: typeof DISDEX_V96_STRATEGY_ID;
    referenceTs: number;
    core: DisDexV95CoreSignal;
    pengu: DisDexPenguV46Signal;
    targetWeights: Partial<Record<DisDexV35Symbol, number>>;
    allocation: ReturnType<typeof allocateDisDexV96ReservedPengu>;
    penguGrossCapApplied: number;
    executionParityNotice: "V95_WEIGHT_BAND_STRONG_BOOST_TYPESCRIPT_GOLDEN_VECTOR_PASS";
}

export function buildDisDexV96CombinedSignal(
    history: DisDexPenguV46History,
    now = Date.now(),
    options: { penguTargetGrossCap?: number; totalGrossCap?: number } = {},
): DisDexV96CombinedSignal {
    const core = buildDisDexV95CoreSignal(history, now);
    const pengu = buildLegacyPenguSignal(history, now);
    const requestedPenguGross = pengu.side === 0 ? 0 : DISDEX_V96_ALLOCATION.penguTargetGross;
    const suppliedCap = Number(options.penguTargetGrossCap);
    const penguGrossCapApplied = Number.isFinite(suppliedCap) && suppliedCap > 0
        ? Math.min(requestedPenguGross, suppliedCap)
        : requestedPenguGross;
    const suppliedTotalGrossCap = Number(options.totalGrossCap);
    const totalGrossCap = Number.isFinite(suppliedTotalGrossCap) && suppliedTotalGrossCap > 0
        ? suppliedTotalGrossCap
        : DISDEX_V96_ALLOCATION.totalGrossCap;
    const allocation = allocateDisDexV96ReservedPengu({
        coreWeights: core.targetWeights as Record<string, number>,
        penguSide: pengu.side,
        penguTargetGross: penguGrossCapApplied,
        totalGrossCap,
        minimumActivePenguClip: DISDEX_V96_ALLOCATION.minimumActivePenguClip,
    });
    return {
        strategyId: DISDEX_V96_STRATEGY_ID,
        referenceTs: Math.max(core.referenceTs, pengu.decisionTs || 0),
        core,
        pengu,
        targetWeights: allocation.targetWeights as Partial<Record<DisDexV35Symbol, number>>,
        allocation,
        penguGrossCapApplied,
        executionParityNotice: "V95_WEIGHT_BAND