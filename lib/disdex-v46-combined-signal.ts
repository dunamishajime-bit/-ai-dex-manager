import { DISDEX_V35_PENGU_RULE } from "@/config/disdexV35Runtime";
import { DISDEX_V46_RUNTIME } from "@/config/disdexV46Runtime";
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

export interface DisDexV46CombinedSignal {
    strategyId: typeof DISDEX_V46_RUNTIME.strategyId;
    referenceTs: number;
    core: DisDexV35SignalResult;
    pengu: DisDexPenguV46Signal;
    targetWeights: Partial<Record<DisDexV35Symbol, number>>;
    rawGross: number;
    grossScale: number;
    finalGross: number;
}

function finite(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function gross(weights: Partial<Record<DisDexV35Symbol, number>>) {
    return Object.values(weights).reduce((sum, value) => sum + Math.abs(finite(value)), 0);
}

export function buildDisDexV46CombinedSignal(
    history: DisDexPenguV46History,
    now = Date.now(),
): DisDexV46CombinedSignal {
    const core = buildDisDexV35Signal(history, DISDEX_V35_PENGU_RULE, now);
    const pengu = buildDisDexPenguV46Signal(history, now);
    const rawWeights: Partial<Record<DisDexV35Symbol, number>> = {
        ...core.targetWeights,
    };
    if (pengu.side !== 0 && pengu.targetGross > 0) {
        rawWeights.PENGUUSDT = pengu.side * pengu.targetGross;
    } else {
        delete rawWeights.PENGUUSDT;
    }
    const rawGross = gross(rawWeights);
    const grossScale = rawGross > DISDEX_V46_RUNTIME.maximumGross && rawGross > 0
        ? DISDEX_V46_RUNTIME.maximumGross / rawGross
        : 1;
    const targetWeights = Object.fromEntries(
        Object.entries(rawWeights)
            .map(([symbol, weight]) => [symbol, finite(weight) * grossScale])
            .filter(([, weight]) => Math.abs(finite(weight)) > 1e-12),
    ) as Partial<Record<DisDexV35Symbol, number>>;
    return {
        strategyId: DISDEX_V46_RUNTIME.strategyId,
        referenceTs: Math.max(core.referenceTs, pengu.decisionTs ?? 0),
        core,
        pengu,
        targetWeights,
        rawGross,
        grossScale,
        finalGross: gross(targetWeights),
    };
}
