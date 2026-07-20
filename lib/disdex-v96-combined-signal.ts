import { DISDEX_V35_PENGU_RULE } from "@/config/disdexV35Runtime";
import { DISDEX_V96_ALLOCATION, DISDEX_V96_STRATEGY_ID } from "@/config/disdexV96Runtime";
import { allocateDisDexV96ReservedPengu } from "@/lib/disdex-v96-allocation";
import {
    buildDisDexV35Signal,
    type DisDexV35SignalResult,
    type DisDexV35Symbol,
} from "@/lib/disdex-v35-signal-engine";
import {
    buildDisDexPenguV46Signal,
    type DisDexPenguV46History,
    type DisDexPenguV46Signal,
} from "@/lib/pengu-dual-engine-v46";

export interface DisDexV96CombinedSignal {
    strategyId: typeof DISDEX_V96_STRATEGY_ID;
    referenceTs: number;
    core: DisDexV35SignalResult;
    pengu: DisDexPenguV46Signal;
    targetWeights: Partial<Record<DisDexV35Symbol, number>>;
    allocation: ReturnType<typeof allocateDisDexV96ReservedPengu>;
    executionParityNotice: "V95_WEIGHT_BAND_STRONG_BOOST_PENDING_TYPESCRIPT_PARITY_REVIEW";
}

export function buildDisDexV96CombinedSignal(
    history: DisDexPenguV46History,
    now = Date.now(),
): DisDexV96CombinedSignal {
    const core = buildDisDexV35Signal(history, DISDEX_V35_PENGU_RULE, now);
    const pengu = buildDisDexPenguV46Signal(history, now);
    const allocation = allocateDisDexV96ReservedPengu({
        coreWeights: core.targetWeights as Record<string, number>,
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
        executionParityNotice: "V95_WEIGHT_BAND_STRONG_BOOST_PENDING_TYPESCRIPT_PARITY_REVIEW",
    };
}
