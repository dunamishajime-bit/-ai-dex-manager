import type { DirectAccountSnapshot, DirectPosition } from "@/lib/direct-trade-executor";
import type { DisDexV35RebalanceAction } from "@/lib/disdex-v35-portfolio-runner";

const EPSILON = 1e-9;

export interface DisDexV96ExecutionCapacityConfig {
    cashReservePct: number;
    maxGross: number;
    maxSlippageBps: number;
    minOrderNotionalUsd: number;
    roundTripFeeBps: number;
    minimumExecutionHeadroomUsd: number;
}

export interface DisDexV96ExecutionCapacityPlan {
    action: DisDexV35RebalanceAction;
    signalTargetWeight: number;
    executionTargetWeight: number;
    requestedIncreaseUsd: number;
    executableIncreaseUsd: number;
    executionScale: number;
    equityUsd: number;
    reportedAvailableBalanceUsd: number;
    requiredInitialMarginUsd: number;
    reconstructedAvailableBalanceUsd: number;
    effectiveAvailableBalanceUsd: number;
    cashReserveUsd: number;
    estimatedCostHeadroomUsd: number;
    protectedCashUsd: number;
    availableIncreaseCapacityUsd: number;
    grossIncreaseCapacityUsd: number;
    currentAccountGrossNotionalUsd: number;
    externalGrossNotionalUsd: number;
    projectedManagedGross: number;
    projectedPortfolioGross: number;
    wasScaled: boolean;
    blockedReason?: string;
}

function finiteNonNegative(value: unknown, name: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error(`${name} must be finite and non-negative.`);
    return number;
}

function grossNotionalUsd(positions: DirectPosition[], label: string) {
    return positions.reduce((sum, position) => {
        const notional = Number(position.notionalUsd);
        if (!Number.isFinite(notional)) throw new Error(`${label} ${position.symbol} notional is invalid.`);
        return sum + Math.abs(notional);
    }, 0);
}

export function disDexV96AccountEquity(account: DirectAccountSnapshot, positions: DirectPosition[]) {
    const walletBalance = finiteNonNegative(account.walletBalance, "V96 wallet balance");
    const unrealizedPnl = positions.reduce((sum, position) => {
        const value = Number(position.unrealizedPnl);
        if (!Number.isFinite(value)) throw new Error(`V96 ${position.symbol} unrealized PnL is invalid.`);
        return sum + value;
    }, 0);
    const equity = walletBalance + unrealizedPnl;
    if (!Number.isFinite(equity) || equity <= 0) throw new Error("V96 account equity is not positive.");
    return equity;
}

export function disDexV96RequiredInitialMarginUsd(positions: DirectPosition[]) {
    return positions.reduce((sum, position) => {
        const notional = finiteNonNegative(Math.abs(position.notionalUsd), `V96 ${position.symbol} notional`);
        const leverage = Number(position.leverage);
        if (!Number.isFinite(leverage) || leverage < 1) throw new Error(`V96 ${position.symbol} leverage is invalid.`);
        return sum + notional / leverage;
    }, 0);
}

export function shouldSkipDisDexV96Signal(input: {
    configuredReferenceTs?: number;
    signalReferenceTs: number;
    symbol: string;
    side: string;
    reduceOnly: boolean;
}) {
    const configured = Number(input.configuredReferenceTs);
    return Number.isFinite(configured)
        && configured > 0
        && input.signalReferenceTs === configured
        && input.symbol.toUpperCase() === "ETHUSDT"
        && input.side.toUpperCase() === "BUY"
        && !input.reduceOnly;
}

export function planDisDexV96ExecutionCapacity(input: {
    account: DirectAccountSnapshot;
    positions: DirectPosition[];
    managedPositions: DirectPosition[];
    action: DisDexV35RebalanceAction;
    config: DisDexV96ExecutionCapacityConfig;
}): DisDexV96ExecutionCapacityPlan {
    const { action, config } = input;
    const equityUsd = disDexV96AccountEquity(input.account, input.positions);
    const reportedAvailableBalanceUsd = finiteNonNegative(input.account.availableBalance, "V96 available balance");
    const requiredInitialMarginUsd = disDexV96RequiredInitialMarginUsd(input.positions);
    const reconstructedAvailableBalanceUsd = Math.max(0, equityUsd - requiredInitialMarginUsd);
    const consistencyAllowance = Math.max(1, equityUsd * 0.10);
    if (reportedAvailableBalanceUsd > equityUsd + consistencyAllowance) {
        throw new Error("V96 available balance is inconsistent with account equity; manual review is required.");
    }
    const effectiveAvailableBalanceUsd = Math.min(reportedAvailableBalanceUsd, reconstructedAvailableBalanceUsd);
    const cashReservePct = finiteNonNegative(config.cashReservePct, "V96 Cash Reserve percentage");
    const cashReserveUsd = equityUsd * Math.min(100, cashReservePct) / 100;
    const roundTripFeeBps = finiteNonNegative(config.roundTripFeeBps, "V96 round-trip fee bps");
    const maxSlippageBps = finiteNonNegative(config.maxSlippageBps, "V96 maximum slippage bps");
    const minimumExecutionHeadroomUsd = finiteNonNegative(config.minimumExecutionHeadroomUsd, "V96 minimum execution headroom");
    const requestedIncreaseUsd = action.reduceOnly
        ? 0
        : Math.max(0, Math.abs(action.targetNotionalUsd) - Math.abs(action.currentNotionalUsd));
    const estimatedCostHeadroomUsd = requestedIncreaseUsd * (roundTripFeeBps + maxSlippageBps) / 10_000;
    const protectedCashUsd = Math.max(cashReserveUsd, estimatedCostHeadroomUsd, minimumExecutionHeadroomUsd);
    const availableIncreaseCapacityUsd = Math.max(0, effectiveAvailableBalanceUsd - protectedCashUsd);

    const currentAccountGrossNotionalUsd = grossNotionalUsd(input.positions, "V96 account");
    const currentManagedGrossNotionalUsd = grossNotionalUsd(input.managedPositions, "V96 managed");
    const externalGrossNotionalUsd = Math.max(0, currentAccountGrossNotionalUsd - currentManagedGrossNotionalUsd);
    const otherManagedGrossNotionalUsd = Math.max(0, currentManagedGrossNotionalUsd - Math.abs(action.currentNotionalUsd));
    const maxGross = finiteNonNegative(config.maxGross, "V96 maximum Gross");
    if (maxGross <= 0) throw new Error("V96 maximum Gross must be positive.");
    const maximumTargetNotionalByGrossUsd = Math.max(
        0,
        maxGross * equityUsd - externalGrossNotionalUsd - otherManagedGrossNotionalUsd,
    );
    const grossIncreaseCapacityUsd = Math.max(0, maximumTargetNotionalByGrossUsd - Math.abs(action.currentNotionalUsd));

    if (action.reduceOnly || requestedIncreaseUsd <= EPSILON) {
        const projectedManagedGross = (otherManagedGrossNotionalUsd + Math.abs(action.targetNotionalUsd)) / equityUsd;
        const projectedPortfolioGross = (
            externalGrossNotionalUsd + otherManagedGrossNotionalUsd + Math.abs(action.targetNotionalUsd)
        ) / equityUsd;
        return {
            action,
            signalTargetWeight: action.targetWeight,
            executionTargetWeight: action.targetWeight,
            requestedIncreaseUsd,
            executableIncreaseUsd: requestedIncreaseUsd,
            executionScale: 1,
            equityUsd,
            reportedAvailableBalanceUsd,
            requiredInitialMarginUsd,
            reconstructedAvailableBalanceUsd,
            effectiveAvailableBalanceUsd,
            cashReserveUsd,
            estimatedCostHeadroomUsd,
            protectedCashUsd,
            availableIncreaseCapacityUsd,
            grossIncreaseCapacityUsd,
            currentAccountGrossNotionalUsd,
            externalGrossNotionalUsd,
            projectedManagedGross,
            projectedPortfolioGross,
            wasScaled: false,
        };
    }

    const executableIncreaseUsd = Math.min(requestedIncreaseUsd, availableIncreaseCapacityUsd, grossIncreaseCapacityUsd);
    const executionScale = requestedIncreaseUsd > 0 ? executableIncreaseUsd / requestedIncreaseUsd : 1;
    const targetDirection = Math.sign(action.targetNotionalUsd || action.deltaNotionalUsd || (action.side === "BUY" ? 1 : -1)) || 1;
    const deltaDirection = Math.sign(action.deltaNotionalUsd || (action.side === "BUY" ? 1 : -1)) || targetDirection;
    const executionTargetNotionalAbsUsd = Math.abs(action.currentNotionalUsd) + executableIncreaseUsd;
    const originalTargetNotionalAbsUsd = Math.abs(action.targetNotionalUsd);
    const targetScale = originalTargetNotionalAbsUsd > EPSILON
        ? executionTargetNotionalAbsUsd / originalTargetNotionalAbsUsd
        : executionScale;
    const executionTargetWeight = action.targetWeight * Math.min(1, Math.max(0, targetScale));
    const adjustedAction: DisDexV35RebalanceAction = {
        ...action,
        quantity: action.quantity * executionScale,
        targetNotionalUsd: targetDirection * executionTargetNotionalAbsUsd,
        targetWeight: executionTargetWeight,
        deltaNotionalUsd: deltaDirection * executableIncreaseUsd,
        reason: executionScale + EPSILON < 1
            ? `${action.reason} Execution size was proportionally reduced to available V96 balance and shared portfolio Gross capacity.`
            : action.reason,
    };
    const projectedManagedGross = (otherManagedGrossNotionalUsd + executionTargetNotionalAbsUsd) / equityUsd;
    const projectedPortfolioGross = (
        externalGrossNotionalUsd + otherManagedGrossNotionalUsd + executionTargetNotionalAbsUsd
    ) / equityUsd;
    if (projectedPortfolioGross > maxGross + EPSILON) {
        throw new Error(`V96 projected portfolio Gross ${projectedPortfolioGross.toFixed(8)} exceeds ${maxGross}; manual review is required.`);
    }
    const minimumOrderNotionalUsd = finiteNonNegative(config.minOrderNotionalUsd, "V96 minimum order notional");
    const blockedReason = executableIncreaseUsd + EPSILON < minimumOrderNotionalUsd
        ? `V96 executable increase ${executableIncreaseUsd.toFixed(4)} USD is below the minimum order notional after Cash Reserve, cost headroom, margin and shared portfolio Gross checks.`
        : undefined;
    return {
        action: adjustedAction,
        signalTargetWeight: action.targetWeight,
        executionTargetWeight,
        requestedIncreaseUsd,
        executableIncreaseUsd,
        executionScale,
        equityUsd,
        reportedAvailableBalanceUsd,
        requiredInitialMarginUsd,
        reconstructedAvailableBalanceUsd,
        effectiveAvailableBalanceUsd,
        cashReserveUsd,
        estimatedCostHeadroomUsd,
        protectedCashUsd,
        availableIncreaseCapacityUsd,
        grossIncreaseCapacityUsd,
        currentAccountGrossNotionalUsd,
        externalGrossNotionalUsd,
        projectedManagedGross,
        projectedPortfolioGross,
        wasScaled: executionScale + EPSILON < 1,
        blockedReason,
    };
}
