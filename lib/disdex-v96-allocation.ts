import { DISDEX_V96_ALLOCATION } from "@/config/disdexV96Runtime";

export type DisDexV96WeightMap = Record<string, number>;

export interface DisDexV96AllocationResult {
    targetWeights: DisDexV96WeightMap;
    rawCoreGross: number;
    scaledCoreGross: number;
    coreScale: number;
    penguTargetGross: number;
    penguFinalGross: number;
    penguClip: number;
    reservedPenguGross: number;
    finalGross: number;
}

function finite(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function gross(weights: DisDexV96WeightMap) {
    return Object.values(weights).reduce((sum, value) => sum + Math.abs(finite(value)), 0);
}

function scaleWeights(weights: DisDexV96WeightMap, scale: number) {
    return Object.fromEntries(
        Object.entries(weights)
            .map(([symbol, weight]) => [symbol, finite(weight) * scale])
            .filter(([, weight]) => Math.abs(finite(weight)) > 1e-12),
    );
}

export function allocateDisDexV96ReservedPengu(input: {
    coreWeights: DisDexV96WeightMap;
    penguSide: -1 | 0 | 1;
    penguTargetGross?: number;
    totalGrossCap?: number;
    minimumActivePenguClip?: number;
}): DisDexV96AllocationResult {
    const totalGrossCap = finite(input.totalGrossCap, DISDEX_V96_ALLOCATION.totalGrossCap);
    const penguTargetGross = Math.max(0, finite(input.penguTargetGross, DISDEX_V96_ALLOCATION.penguTargetGross));
    const minimumActivePenguClip = Math.min(1, Math.max(0, finite(
        input.minimumActivePenguClip,
        DISDEX_V96_ALLOCATION.minimumActivePenguClip,
    )));
    if (totalGrossCap <= 0) throw new Error("V96 total Gross cap must be positive.");
    if (![-1, 0, 1].includes(input.penguSide)) throw new Error("V96 PENGU side must be -1, 0 or 1.");

    const cleanCore = Object.fromEntries(
        Object.entries(input.coreWeights)
            .filter(([symbol]) => symbol.toUpperCase() !== "PENGUUSDT")
            .map(([symbol, weight]) => [symbol.toUpperCase(), finite(weight)])
            .filter(([, weight]) => Math.abs(finite(weight)) > 1e-12),
    );
    const rawCoreGross = gross(cleanCore);

    if (input.penguSide === 0 || penguTargetGross <= 0) {
        const coreScale = rawCoreGross > totalGrossCap && rawCoreGross > 0 ? totalGrossCap / rawCoreGross : 1;
        const targetWeights = scaleWeights(cleanCore, coreScale);
        const finalGross = gross(targetWeights);
        if (finalGross > totalGrossCap + 1e-9) throw new Error("V96 Gross cap exceeded without active PENGU.");
        return {
            targetWeights,
            rawCoreGross,
            scaledCoreGross: finalGross,
            coreScale,
            penguTargetGross: 0,
            penguFinalGross: 0,
            penguClip: 0,
            reservedPenguGross: 0,
            finalGross,
        };
    }

    const minimumPenguGross = minimumActivePenguClip * penguTargetGross;
    if (minimumPenguGross > totalGrossCap + 1e-9) {
        throw new Error("V96 minimum PENGU reservation exceeds the total Gross cap.");
    }
    // When the portfolio cap can hold the full PENGU target, reserve the full
    // target first and scale Core into the residual. Under a smaller cap, keep
    // the legacy minimum clip so fail-closed combined configurations still work.
    const reservedPenguGross = totalGrossCap + 1e-9 >= penguTargetGross
        ? penguTargetGross
        : minimumPenguGross;
    const coreCapacity = Math.max(0, totalGrossCap - reservedPenguGross);
    const coreScale = rawCoreGross > 0 ? Math.min(1, coreCapacity / rawCoreGross) : 1;
    const scaledCoreWeights = scaleWeights(cleanCore, coreScale);
    const scaledCoreGross = gross(scaledCoreWeights);
    const remainingCapacity = Math.max(0, totalGrossCap - scaledCoreGross);
    const capacityClip = penguTargetGross > 0 ? remainingCapacity / penguTargetGross : 0;
    const penguClip = Math.min(1, Math.max(minimumActivePenguClip, capacityClip));
    const penguFinalGross = penguTargetGross * penguClip;
    const targetWeights: DisDexV96WeightMap = {
        ...scaledCoreWeights,
        PENGUUSDT: input.penguSide * penguFinalGross,
    };
    const finalGross = gross(targetWeights);
    if (penguClip + 1e-12 < minimumActivePenguClip) throw new Error("V96 PENGU clip fell below the declared minimum.");
    if (finalGross > totalGrossCap + 1e-9) throw new Error(`V96 Gross cap exceeded: ${finalGross}`);
    return {
        targetWeights,
        rawCoreGross,
        scaledCoreGross,
        coreScale,
        penguTargetGross,
        penguFinalGross,
        penguClip,
        reservedPenguGross,
        finalGross,
    };
}
