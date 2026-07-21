import { DISDEX_V96_ALLOCATION } from "@/config/disdexV96Runtime";

export type DisDexV95CoreWeightMap = Record<string, number>;

export interface DisDexV95CoreFeatures {
    closeAboveSma20: boolean;
    mom20: number;
    mom3: number;
    shock: number;
    skew: number;
    btcVol?: number;
}

export interface DisDexV95CoreFrame {
    referenceTs: number;
    rawTarget: DisDexV95CoreWeightMap;
    v35Scale: number;
    symbolReturns: DisDexV95CoreWeightMap;
    regime: number;
    features: DisDexV95CoreFeatures;
}

export interface DisDexV95CoreRow {
    referenceTs: number;
    rawTarget: DisDexV95CoreWeightMap;
    stableTarget: DisDexV95CoreWeightMap;
    controlledTarget: DisDexV95CoreWeightMap;
    weightBandAction: "SIGNATURE" | "REBALANCE" | "HOLD";
    turnover: number;
    breadth: number;
    baseReturn: number;
    controlledReturn: number;
    baseGross: number;
    finalGross: number;
    coreScale: number;
    boost: number;
    whipsawActive: boolean;
    drawdownStage: 0 | 1 | 2;
    portfolioDrawdown: number;
}

export interface DisDexV95CoreControllerResult {
    rows: DisDexV95CoreRow[];
    finalTarget: DisDexV95CoreWeightMap;
    finalGross: number;
    diagnostics: {
        ignoredWeightChanges: number;
        acceptedWeightRebalances: number;
        signatureChangesImmediate: number;
        growthBuckets: number;
        whipsawBuckets: number;
        drawdownStageBuckets: Record<0 | 1 | 2, number>;
        cappedBuckets: number;
        finalEquity: number;
        finalPeak: number;
    };
}

const CORE_GROSS_CAP = 2;
const WEIGHT_TOLERANCE = DISDEX_V96_ALLOCATION.corePolicy.weightBandTolerancePct / 100;
const PORTFOLIO_TURNOVER_THRESHOLD = DISDEX_V96_ALLOCATION.corePolicy.portfolioRebalanceThresholdPct / 100;
const MAXIMUM_STALE_BARS = DISDEX_V96_ALLOCATION.corePolicy.forcedRefreshBars;
const STRONG_BOOST = DISDEX_V96_ALLOCATION.corePolicy.strongBoostPct / 100;

const DD_START = 0.12;
const DD_SECOND_GAP = 0.08;
const DD_WINDOW_BUCKETS = 20;
const DD_TRIGGER_RETURN = -0.04;
const DD_SCALE_1 = 0.85;
const DD_SCALE_2 = 0.40;

const WHIPSAW_WINDOW_BUCKETS = 10;
const WHIPSAW_TURNOVER_THRESHOLD = 1.5;
const WHIPSAW_FLIP_THRESHOLD = 3;
const WHIPSAW_CORE_SCALE = 0.60;
const WHIPSAW_CONFIRMATION_BUCKETS = 1;
const WHIPSAW_RECOVERY_BUCKETS = 2;

function finite(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function cleanWeights(weights: DisDexV95CoreWeightMap) {
    return Object.fromEntries(
        Object.entries(weights)
            .map(([symbol, weight]) => [symbol.toUpperCase(), finite(weight)])
            .filter(([, weight]) => Math.abs(finite(weight)) > 1e-12),
    );
}

function gross(weights: DisDexV95CoreWeightMap) {
    return Object.values(weights).reduce((sum, weight) => sum + Math.abs(finite(weight)), 0);
}

function scaleWeights(weights: DisDexV95CoreWeightMap, scale: number) {
    return Object.fromEntries(
        Object.entries(weights)
            .map(([symbol, weight]) => [symbol, finite(weight) * scale])
            .filter(([, weight]) => Math.abs(finite(weight)) > 1e-12),
    );
}

function signature(weights: DisDexV95CoreWeightMap) {
    return Object.entries(weights)
        .filter(([, weight]) => Math.abs(finite(weight)) > 1e-12)
        .map(([symbol, weight]) => `${symbol}:${finite(weight) > 0 ? 1 : -1}`)
        .sort()
        .join("|");
}

export function disDexV95Turnover(left: DisDexV95CoreWeightMap, right: DisDexV95CoreWeightMap) {
    const symbols = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...symbols].reduce((sum, symbol) => sum + Math.abs(finite(right[symbol]) - finite(left[symbol])), 0);
}

function compounded(returns: number[]) {
    return returns.reduce((equity, value) => equity * Math.max(0.001, 1 + finite(value)), 1) - 1;
}

function countFlips(regimes: number[]) {
    let flips = 0;
    for (let index = 1; index < regimes.length; index += 1) {
        if (regimes[index] !== 0 && regimes[index - 1] !== 0 && regimes[index] !== regimes[index - 1]) flips += 1;
    }
    return flips;
}

function strongSignal(frame: DisDexV95CoreFrame, breadth: number) {
    const gate = DISDEX_V96_ALLOCATION.corePolicy.strongBoostCompleted12hGate;
    const feature = frame.features;
    return frame.regime > 0
        && feature.closeAboveSma20
        && finite(feature.mom20) >= gate.momentum20PctMinimum
        && finite(feature.mom3) >= gate.momentum3PctExclusiveMinimum
        && finite(feature.shock) >= gate.shockPctMinimum
        && finite(feature.skew, 1) <= gate.skewMaximum
        && breadth >= gate.breadthMinimum;
}

export function runDisDexV95CoreController(frames: DisDexV95CoreFrame[]): DisDexV95CoreControllerResult {
    let active: DisDexV95CoreWeightMap = {};
    let lastWeightRebalance = 0;
    let previousStable: DisDexV95CoreWeightMap = {};
    let equity = 1;
    let peak = 1;
    const referenceReturns: number[] = [];
    const turnoverHistory: number[] = [];
    const regimeHistory: number[] = [];
    let signalCount = 0;
    let calmCount = 0;
    let whipsawActive = false;

    let ignoredWeightChanges = 0;
    let acceptedWeightRebalances = 0;
    let signatureChangesImmediate = 0;
    let growthBuckets = 0;
    let whipsawBuckets = 0;
    let cappedBuckets = 0;
    const drawdownStageBuckets: Record<0 | 1 | 2, number> = { 0: 0, 1: 0, 2: 0 };
    const rows: DisDexV95CoreRow[] = [];

    for (const [index, frame] of frames.entries()) {
        const desired = cleanWeights(frame.rawTarget);
        let weightBandAction: DisDexV95CoreRow["weightBandAction"] = "HOLD";
        if (signature(desired) !== signature(active)) {
            active = desired;
            lastWeightRebalance = index;
            signatureChangesImmediate += 1;
            weightBandAction = "SIGNATURE";
        } else {
            const proposed = { ...active };
            let changed = false;
            const symbols = new Set([...Object.keys(active), ...Object.keys(desired)]);
            for (const symbol of symbols) {
                const oldWeight = finite(active[symbol]);
                const newWeight = finite(desired[symbol]);
                if (Math.abs(newWeight - oldWeight) >= WEIGHT_TOLERANCE) {
                    if (Math.abs(newWeight) <= 1e-12) delete proposed[symbol];
                    else proposed[symbol] = newWeight;
                    changed = true;
                } else if (Math.abs(newWeight - oldWeight) > 1e-12) {
                    ignoredWeightChanges += 1;
                }
            }
            const proposedTurnover = signature(proposed) === signature(active) && JSON.stringify(proposed) === JSON.stringify(active)
                ? 0
                : disDexV95Turnover(active, proposed);
            const forced = index - lastWeightRebalance >= MAXIMUM_STALE_BARS;
            if (changed && (proposedTurnover >= PORTFOLIO_TURNOVER_THRESHOLD || forced)) {
                active = cleanWeights(proposed);
                lastWeightRebalance = index;
                acceptedWeightRebalances += 1;
                weightBandAction = "REBALANCE";
            }
        }

        const stableTarget = { ...active };
        const turnover = disDexV95Turnover(previousStable, stableTarget);
        const breadth = Object.entries(previousStable).filter(([symbol, weight]) => symbol !== "BTCUSDT" && finite(weight) > 0).length;
        const baseTarget = scaleWeights(stableTarget, Math.max(0, finite(frame.v35Scale, 1)));
        const baseGross = gross(baseTarget);
        const baseReturn = Object.entries(baseTarget).reduce(
            (sum, [symbol, weight]) => sum + finite(weight) * finite(frame.symbolReturns[symbol]),
            0,
        );

        const portfolioDrawdown = equity / peak - 1;
        const recentCore = referenceReturns.length ? compounded(referenceReturns.slice(-DD_WINDOW_BUCKETS)) : 0;
        let drawdownStage: 0 | 1 | 2 = 0;
        let drawdownScale = 1;
        if (portfolioDrawdown <= -(DD_START + DD_SECOND_GAP) && recentCore <= DD_TRIGGER_RETURN) {
            drawdownStage = 2;
            drawdownScale = DD_SCALE_2;
        } else if (portfolioDrawdown <= -DD_START && recentCore <= DD_TRIGGER_RETURN) {
            drawdownStage = 1;
            drawdownScale = DD_SCALE_1;
        }
        drawdownStageBuckets[drawdownStage] += 1;

        const recentTurnover = turnoverHistory.slice(-WHIPSAW_WINDOW_BUCKETS).reduce((sum, value) => sum + value, 0);
        const recentFlips = countFlips(regimeHistory.slice(-WHIPSAW_WINDOW_BUCKETS));
        const whipsawSignal = recentTurnover >= WHIPSAW_TURNOVER_THRESHOLD || recentFlips >= WHIPSAW_FLIP_THRESHOLD;
        if (whipsawSignal) {
            signalCount += 1;
            calmCount = 0;
        } else {
            calmCount += 1;
            signalCount = 0;
        }
        if (!whipsawActive && signalCount >= WHIPSAW_CONFIRMATION_BUCKETS) whipsawActive = true;
        else if (whipsawActive && calmCount >= WHIPSAW_RECOVERY_BUCKETS) whipsawActive = false;
        if (whipsawActive) whipsawBuckets += 1;

        let boost = 0;
        if (drawdownStage === 0 && !whipsawActive && portfolioDrawdown > -0.05 && strongSignal(frame, breadth)) {
            boost = STRONG_BOOST;
            growthBuckets += 1;
        }
        const rawScale = drawdownScale * (whipsawActive ? WHIPSAW_CORE_SCALE : 1) * (1 + boost);
        const rawGross = baseGross * rawScale;
        const capRatio = rawGross > 0 ? Math.min(1, CORE_GROSS_CAP / rawGross) : 1;
        if (capRatio < 1 - 1e-12) cappedBuckets += 1;
        const coreScale = rawScale * capRatio;
        const controlledTarget = scaleWeights(baseTarget, coreScale);
        const controlledReturn = baseReturn * coreScale;

        rows.push({
            referenceTs: frame.referenceTs,
            rawTarget: desired,
            stableTarget,
            controlledTarget,
            weightBandAction,
            turnover,
            breadth,
            baseReturn,
            controlledReturn,
            baseGross,
            finalGross: gross(controlledTarget),
            coreScale,
            boost,
            whipsawActive,
            drawdownStage,
            portfolioDrawdown,
        });

        equity *= Math.max(0.001, 1 + controlledReturn);
        peak = Math.max(peak, equity);
        referenceReturns.push(baseReturn);
        turnoverHistory.push(turnover);
        regimeHistory.push(Math.trunc(finite(frame.regime)));
        previousStable = stableTarget;
    }

    const finalTarget = rows.at(-1)?.controlledTarget || {};
    return {
        rows,
        finalTarget,
        finalGross: gross(finalTarget),
        diagnostics: {
            ignoredWeightChanges,
            acceptedWeightRebalances,
            signatureChangesImmediate,
            growthBuckets,
            whipsawBuckets,
            drawdownStageBuckets,
            cappedBuckets,
            finalEquity: equity,
            finalPeak: peak,
        },
    };
}
