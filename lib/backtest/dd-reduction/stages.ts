import type { Direction, StageId, StrategyId } from "./types";

export { type StageId } from "./types";

export const SEQUENTIAL_STAGES: readonly StageId[] = [
    "V12_V4_LONG",
    "V12_V4_SHORT",
    "Q102_LONG",
    "Q102_SHORT",
    "PENGU_LONG",
    "PENGU_SHORT",
    "FET",
    "HYPE_LONG",
    "IDLE_SHORT",
    "IDLE_RESIDUAL",
    "V52",
] as const;

const STAGE_STRATEGIES: Readonly<Record<StageId, StrategyId>> = {
    V12_V4_LONG: "V12_V4",
    V12_V4_SHORT: "V12_V4",
    Q102_LONG: "Q102",
    Q102_SHORT: "Q102",
    PENGU_LONG: "PENGU",
    PENGU_SHORT: "PENGU",
    FET: "FET",
    HYPE_LONG: "HYPE",
    IDLE_SHORT: "IDLE",
    IDLE_RESIDUAL: "IDLE",
    V52: "V52",
};

const STAGE_DIRECTIONS: Readonly<Partial<Record<StageId, Direction>>> = {
    V12_V4_LONG: "LONG",
    V12_V4_SHORT: "SHORT",
    Q102_LONG: "LONG",
    Q102_SHORT: "SHORT",
    PENGU_LONG: "LONG",
    PENGU_SHORT: "SHORT",
    HYPE_LONG: "LONG",
    IDLE_SHORT: "SHORT",
};

export function strategyForStage(stage: StageId): StrategyId {
    return STAGE_STRATEGIES[stage];
}

export function directionForStage(stage: StageId): Direction | null {
    return STAGE_DIRECTIONS[stage] ?? null;
}

export function stageAcceptsDirection(stage: StageId, direction: Direction): boolean {
    const requiredDirection = directionForStage(stage);
    return requiredDirection === null || requiredDirection === direction;
}
