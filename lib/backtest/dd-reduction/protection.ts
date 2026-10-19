import type {
    Direction,
    ExecutionBar,
    PositionLifecycle,
    StrategyId,
} from "./types";

export interface ProtectionPolicyInput {
    readonly policyHash: string;
    readonly configHash: string;
    readonly strategy: StrategyId;
    readonly direction: Direction;
    readonly initialStopBps?: number;
    readonly initialStop?: number;
    readonly profitActivationBps?: number;
    readonly profitActivation?: number;
    readonly profitFloorBps?: number;
    readonly profitFloor?: number;
    readonly trailActivationBps?: number;
    readonly trailActivation?: number;
    readonly trailRetraceBps?: number;
    readonly trailRetrace?: number;
    readonly timeStopBars?: number | null;
    readonly timeStop?: number | null;
    readonly tickSize?: number;
}

export type ProtectionTrigger = "INITIAL_STOP" | "PROFIT_FLOOR" | "TRAIL" | "TIME_STOP" | "NONE";
export type ProtectionEventKind =
    | "STOP_PLACED"
    | "STOP_REPLACED"
    | "PROTECTION_ACTIVATED"
    | "GIVEBACK"
    | "TIME_STOP"
    | "REPROTECT";

export interface ProtectionEvent {
    readonly kind: ProtectionEventKind;
    readonly ts: number;
    readonly quantity: number;
    readonly price: number;
    readonly reason: string;
}

export interface ProtectionState {
    readonly entryPrice: number;
    readonly direction: Direction;
    readonly activated: boolean;
    readonly mfeBps: number;
    readonly mfePrice: number;
    readonly favorableBps: number;
    readonly profitFloorPrice: number | null;
    readonly trailPrice: number | null;
    readonly stopPrice: number;
    readonly givebackBps: number;
    readonly remainingQuantity: number;
    readonly protectedQuantity: number;
    readonly reprotectQuantity: number;
    readonly barsHeld: number;
    readonly clientOrderId: string;
    readonly events: readonly ProtectionEvent[];
}

export type PositionLifecycleWithProtection = PositionLifecycle & {
    readonly remainingQuantity: number;
    readonly protectedQuantity: number;
    readonly protection: ProtectionState | null;
};

export interface ProtectionDecision {
    readonly stopPrice: number;
    readonly trigger: ProtectionTrigger;
    readonly protection: ProtectionState;
    readonly events: readonly ProtectionEvent[];
}

function finiteOr(value: number | undefined, fallback: number): number {
    return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function bpsOrPercent(value: number | undefined, fallbackBps: number): number {
    if (value === undefined || !Number.isFinite(value)) return fallbackBps;
    return value <= 1 ? value * 10_000 : value;
}

function roundLongStop(price: number, tick: number): number {
    return Number((Math.floor((price + 1e-9) / tick) * tick).toPrecision(12));
}

function roundShortStop(price: number, tick: number): number {
    return Number((Math.ceil((price - 1e-9) / tick) * tick).toPrecision(12));
}

function roundLongFloor(price: number, tick: number): number {
    return Number((Math.ceil((price - 1e-9) / tick) * tick).toPrecision(12));
}

function roundShortFloor(price: number, tick: number): number {
    return Number((Math.floor((price + 1e-9) / tick) * tick).toPrecision(12));
}

function favorablePrice(direction: Direction, bar: ExecutionBar): number {
    return direction === "LONG" ? bar.high : bar.low;
}

function adversePrice(direction: Direction, bar: ExecutionBar): number {
    return direction === "LONG" ? bar.low : bar.high;
}

function favorableBps(direction: Direction, entry: number, price: number): number {
    const move = direction === "LONG" ? price / entry - 1 : 1 - price / entry;
    return Number((move * 10_000).toPrecision(12));
}

function priceAtBps(direction: Direction, entry: number, bps: number): number {
    return direction === "LONG" ? entry * (1 + bps / 10_000) : entry * (1 - bps / 10_000);
}

function conservativeStop(direction: Direction, price: number, tick: number): number {
    return direction === "LONG" ? roundLongStop(price, tick) : roundShortStop(price, tick);
}

function conservativeFloor(direction: Direction, price: number, tick: number): number {
    return direction === "LONG" ? roundLongFloor(price, tick) : roundShortFloor(price, tick);
}

function initialProtectionId(position: PositionLifecycle): string {
    return `protective-stop:${position.positionId}`;
}

function numericQuantity(position: PositionLifecycleWithProtection): number {
    const entryQuantity = position.entryFill?.quantity ?? 0;
    return Number.isFinite(position.remainingQuantity) ? position.remainingQuantity : entryQuantity;
}

export function positionWithProtection(position: PositionLifecycle): PositionLifecycleWithProtection {
    const candidate = position as Partial<PositionLifecycleWithProtection>;
    const quantity = candidate.remainingQuantity ?? position.entryFill?.quantity ?? 0;
    return {
        ...position,
        remainingQuantity: quantity,
        protectedQuantity: candidate.protectedQuantity ?? quantity,
        protection: candidate.protection ?? null,
    };
}

export function applyProtectionPolicy(
    position: PositionLifecycle,
    policy: ProtectionPolicyInput,
    bar: ExecutionBar,
): ProtectionDecision {
    const runtimePosition = positionWithProtection(position);
    const entryPrice = position.entryFill?.price ?? bar.open;
    if (!(entryPrice > 0) || !Number.isFinite(entryPrice)) throw new Error("PROTECTION_ENTRY_PRICE_INVALID");
    const direction = runtimePosition.direction;
    if (direction !== policy.direction) throw new Error("PROTECTION_DIRECTION_MISMATCH");
    const tick = finiteOr(policy.tickSize, 0.01);
    if (!(tick > 0)) throw new Error("PROTECTION_TICK_INVALID");

    const initialStopBps = bpsOrPercent(policy.initialStop ?? policy.initialStopBps, 500);
    const activationBps = bpsOrPercent(policy.profitActivation ?? policy.profitActivationBps, 100);
    const floorBps = bpsOrPercent(policy.profitFloor ?? policy.profitFloorBps, 0);
    const trailActivationBps = bpsOrPercent(policy.trailActivation ?? policy.trailActivationBps, activationBps);
    const retraceBps = bpsOrPercent(policy.trailRetrace ?? policy.trailRetraceBps, 0);
    const timeStopBars = policy.timeStop ?? policy.timeStopBars ?? null;
    const previous = runtimePosition.protection;
    const mfePrice = previous === null
        ? favorablePrice(direction, bar)
        : direction === "LONG" ? Math.max(previous.mfePrice, favorablePrice(direction, bar)) : Math.min(previous.mfePrice, favorablePrice(direction, bar));
    const mfeBps = Math.max(0, favorableBps(direction, entryPrice, mfePrice));
    const currentFavorableBps = favorableBps(direction, entryPrice, bar.close);
    const activated = previous?.activated === true || mfeBps >= activationBps;
    const initialStop = conservativeStop(direction, priceAtBps(direction, entryPrice, -initialStopBps), tick);
    const floorPrice = activated ? conservativeFloor(direction, priceAtBps(direction, entryPrice, floorBps), tick) : null;
    const trailPrice = activated && mfeBps >= trailActivationBps
        ? conservativeFloor(direction, priceAtBps(direction, mfePrice, direction === "LONG" ? -retraceBps : retraceBps), tick)
        : null;
    const candidates = [initialStop, ...(floorPrice === null ? [] : [floorPrice]), ...(trailPrice === null ? [] : [trailPrice])];
    const stopPrice = direction === "LONG" ? Math.max(...candidates) : Math.min(...candidates);
    const barsHeld = (previous?.barsHeld ?? 0) + 1;
    const givebackBps = Math.max(0, mfeBps - Math.max(0, currentFavorableBps));
    const quantity = numericQuantity(runtimePosition);
    const events: ProtectionEvent[] = [];
    if (previous === null) {
        events.push({ kind: "STOP_PLACED", ts: bar.ts, quantity, price: initialStop, reason: "INITIAL_STOP" });
    }
    if (previous?.activated !== true && activated) {
        events.push({ kind: "PROTECTION_ACTIVATED", ts: bar.ts, quantity, price: floorPrice ?? stopPrice, reason: "MFE_ACTIVATION" });
    }
    if (previous !== null && stopPrice !== previous.stopPrice) {
        events.push({ kind: "STOP_REPLACED", ts: bar.ts, quantity, price: stopPrice, reason: activated ? "PROFIT_PROTECTION" : "STOP_UPDATE" });
    }
    if (previous !== null && givebackBps > 0 && (trailPrice !== null || floorPrice !== null)) {
        events.push({ kind: "GIVEBACK", ts: bar.ts, quantity, price: stopPrice, reason: "MFE_GIVEBACK" });
    }
    if (timeStopBars !== null && barsHeld >= timeStopBars) {
        events.push({ kind: "TIME_STOP", ts: bar.ts, quantity, price: bar.close, reason: "TIME_STOP" });
    }

    let trigger: ProtectionTrigger = "NONE";
    if (timeStopBars !== null && barsHeld >= timeStopBars) trigger = "TIME_STOP";
    else if ((direction === "LONG" && adversePrice(direction, bar) <= stopPrice) || (direction === "SHORT" && adversePrice(direction, bar) >= stopPrice)) {
        trigger = trailPrice !== null ? "TRAIL" : floorPrice !== null ? "PROFIT_FLOOR" : "INITIAL_STOP";
    } else if (trailPrice !== null && givebackBps > 0) trigger = "TRAIL";
    else if (floorPrice !== null) trigger = "PROFIT_FLOOR";

    const protection: ProtectionState = {
        entryPrice,
        direction,
        activated,
        mfeBps,
        mfePrice,
        favorableBps: currentFavorableBps,
        profitFloorPrice: floorPrice,
        trailPrice,
        stopPrice,
        givebackBps,
        remainingQuantity: quantity,
        protectedQuantity: quantity,
        reprotectQuantity: quantity,
        barsHeld,
        clientOrderId: initialProtectionId(runtimePosition),
        events: [...(previous?.events ?? []), ...events],
    };
    return { stopPrice, trigger, protection, events };
}
