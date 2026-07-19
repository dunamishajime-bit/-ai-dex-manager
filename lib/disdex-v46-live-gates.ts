export type DisDexV46RunnerMode = "paper" | "live";

export interface DisDexV46LiveGateInput {
    runnerMode: DisDexV46RunnerMode;
    liveExecutionEnabled: boolean;
    productionConfigLiveEnabled: boolean;
}

export function disDexV46LiveGatesOpen(input: DisDexV46LiveGateInput) {
    return input.runnerMode === "live"
        && input.liveExecutionEnabled === true
        && input.productionConfigLiveEnabled === true;
}

export function assertDisDexV46LiveGate(input: DisDexV46LiveGateInput) {
    if (input.runnerMode !== "live") return;
    if (!disDexV46LiveGatesOpen(input)) {
        throw new Error(
            "V46 live runner is locked. Both DISDEX_V46_LIVE_EXECUTION_ENABLED=true and DISDEX_V46_RUNTIME.liveTradingEnabled=true are required.",
        );
    }
}

export function selectDisDexV46Executor<T>(input: DisDexV46LiveGateInput & {
    liveExecutor: T;
    paperExecutor: T;
}) {
    assertDisDexV46LiveGate(input);
    return disDexV46LiveGatesOpen(input) ? input.liveExecutor : input.paperExecutor;
}
