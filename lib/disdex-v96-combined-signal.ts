import { DISDEX_V96_ALLOCATION, DISDEX_V96_STRATEGY_ID } from "@/config/disdexV96Runtime";
import { allocateDisDexV96ReservedPengu } from "@/lib/disdex-v96-allocation";
import type { DisDexV35Symbol } from "@/lib/disdex-v35-signal-engine";
import {
    buildDisDexPenguV46Signal,
    type DisDexPenguV46History,
    type DisDexPenguV46Signal,
} from "@/lib/pengu-dual-engine-v46";
import { buildDisDexV95CoreSignal, type DisDexV95CoreSignal } from "@/lib/disdex-v95-core-signal";

export interface DisDexV96CombinedSignal {
    strategyId: typeof DISDEX_V96_STRATEGY_ID;
    referenceTs: number;
    core: DisDexV95CoreSignal;
    pengu: DisDexPenguV46Signal;
    targetWeights: Partial<Record<DisDexV35Symbol, number>>;
    allocation: ReturnType<typeof allocateDisDexV96ReservedPengu>;
    executionParityNotice: "V95_WEIGHT_BAND_STRONG_BOOST_TYPESCRIPT_GOLDEN_VECTOR_PASS";
}

export function buildDisDexV96CombinedSignal(
    history: DisDexPenguV46History,
    now = Date.now(),
): DisDexV96CombinedSignal {
    const core = buildDisDexV95CoreSignal(history, now);
    const pengu = buildDisDexPenguV46Signal(history, now);
    const allocation = allocateDisDexV96ReservedPengu({
        coreWeights: core.targetWeights,
        penguSide: pengu.side,
        penguTargetGross: pengu.side === 0 ? 0 : DISDEX_V96_ALLOCATION.penguTargetGross,
        totalGrossCap: DISDEX_V96_ALLOCATION.totalGrossCap,
        minimumActivePenguClip: DISDEX_V96_ALLOCATION.minimumActivePenguClip,
    });
    return {
        strategyId: DISDEX_V96_STRATEGY_ID,
        referenceTs: Math.max(core.referenceTs, pengu.decisionTs || 0),
        core,
        pengu,
        targetWeights: allocation.targetWeights as Partial<Record<DisDexV35Symbol, number>>,
        allocation,
        executionParityNotice: "V95_WEIGHT_BAND_STRONG_BOOST_TYPESCRIPT_GOLDEN_VECTOR_PASS",
    };
}
