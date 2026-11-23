import type { DirectAccountSnapshot, DirectPosition } from "@/lib/direct-trade-executor";
import type { DisDexV35RebalanceAction } from "@/lib/disdex-v35-portfolio-runner";

const EPSILON = 1e-9;

export interface DisDexV96ExecutionCapacityConfig {
    cashReservePct: number;
    maxGross: number;
    portfolioGrossCap?: number;
    targetInitialLeverage?: number;
    maximumInitialMarginFraction?: number;
    minimumAvailableBalanceFractionAfterOrder?: number;
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
    availableMarginUsd: number;
    availableIncreaseCapacityUsd: number;
    grossIncreaseCapacityUsd: number;
    currentAccountGrossNotionalUsd: number;
    externalGrossNotionalUsd: number;
    managedGrossCap: number;
    portfolioGrossCap: number;
    targetInitialLeverage: number;
    maximumInitialMarginFraction: number;
    minimumAvailableBalanceAfterOrderUsd: number;
    projectedInitialMarginUsd: number;
    projectedInitialMarginFraction: number;
    projectedAvailableBalanceUsd: number;
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

function optionalEnvironmentNumber(name: string) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : undefined;
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
    const managedGrossCap = finiteNonNegative(config.maxGross, "V96 managed Gross");
    if (managedGrossCap <= 0) throw new Error("V96 managed Gross must be positive.");
    const portfolioGrossCap = finiteNonNegative(
        config.portfolioGrossCap
            ?? optionalEnvironmentNumber("DISDEX_V52_PORTFOLIO_GROSS_CAP")
            ?? managedGrossCap,
        "Combined portfolio Gross",
    );
    if (portfolioGrossCap < managedGrossCap) {
        throw new Error("Combined portfolio Gross must not be smaller than the V96 managed Gross cap.");
    }
    const targetInitialLeverage = Math.max(
        1,
        finiteNonNegative(
            config.targetInitialLeverage
                ?? optionalEnvironmentNumber("DISDEX_V96_V52_REQUIRED_INITIAL_LEVERAGE")
                ?? 1,
            "V96 target leverage",
        ),
    );
    const maximumInitialMarginFraction = Math.min(
        1,
        finiteNonNegative(
            config.maximumInitialMarginFraction
                ?? optionalEnvironmentNumber("DISDEX_V96_V52_MAX_INITIAL_MARGIN_FRACTION")
                ?? 1,
            "Maximum initial-margin fraction",
        ),
    );
    if (maximumInitialMarginFraction <= 0) throw new Error("Maximum initial-margin fraction must be positive.");
    const minimumAvailableBalanceFractionAfterOrder = Math.min(
        1,
        finiteNonNegative(
            config.minimumAvailableBalanceFractionAfterOrder
                ?? optionalEnvironmentNumber("DISDEX_V96_V52_MIN_AVAILABLE_BALANCE_FRACTION")
                ?? 0,
            "Minimum available-balance fraction after order",
        ),
    );

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
    const minimumAvailableBalanceAfterOrderUsd = equityUsd * minimumAvailableBalanceFractionAfterOrder;
    const protectedCashUsd = Math.max(
        cashReserveUsd,
        estimatedCostHeadroomUsd,
        minimumExecutionHeadroomUsd,
        minimumAvailableBalanceAfterOrderUsd,
    );
    const maximumInitialMarginUsd = equityUsd * maximumInitialMarginFraction;
    const marginRoomByFractionUsd = Math.max(0, maximumInitialMarginUsd - requiredInitialMarginUsd);
    const marginRoomByAvailableBalanceUsd = Math.max(0, effectiveAvailableBalanceUsd - protectedCashUsd);
    const availableMarginUsd = Math.min(marginRoomByFractionUsd, marginRoomByAvailableBalanceUsd);
    const availableIncreaseCapacityUsd = availableMarginUsd * targetInitialLeverage;

    const currentAccountGrossNotionalUsd = grossNotionalUsd(input.positions, "V96 account");
    const currentManagedGrossNotionalUsd = grossNotionalUsd(input.managedPositions, "V96 managed");
    const externalGrossNotionalUsd = Math.max(0, currentAccountGrossNotionalUsd - currentManagedGrossNotionalUsd);
    const otherManagedGrossNotionalUsd = Math.max(0, currentManagedGrossNotionalUsd - Math.abs(action.currentNotionalUsd));
    const maximumTargetNotionalByManagedGrossUsd = Math.max(
        0,
        managedGrossCap * equityUsd - otherManagedGrossNotionalUsd,
    );
    const maximumTargetNotionalByPortfolioGrossUsd = Math.max(
        0,
        portfolioGrossCap * equityUsd - externalGrossNotionalUsd - otherManagedGrossNotionalUsd,
    );
    const maximumTargetNotionalByGrossUsd = Math.min(
        maximumTargetNotionalByManagedGrossUsd,
        maximumTargetNotionalByPortfolioGrossUsd,
    );
    const grossIncreaseCapacityUsd = Math.max(0, maximumTargetNotionalByGrossUsd - Math.abs(action.currentNotionalUsd));

    const buildProjection = (targetNotionalAbsUsd: number, increaseUsd: number) => {
        const projectedInitialMarginUsd = requiredInitialMarginUsd + increaseUsd / targetInitialLeverage;
        const projectedInitialMarginFraction = projectedInitialMarginUsd / equityUsd;
        const projectedAvailableBalanceUsd = Math.max(0, effectiveAvailableBalanceUsd - increaseUsd / targetInitialLeverage);
        const projectedManagedGross = (otherManagedGrossNotionalUsd + targetNotionalAbsUsd) / equityUsd;
        const projectedPortfolioGross = (
            externalGrossNotionalUsd + otherManagedGrossNotionalUsd + targetNotionalAbsUsd
        ) / equityUsd;
        return {
            projectedInitialMarginUsd,
            projectedInitialMarginFraction,
            projectedAvailableBalanceUsd,
            projectedManagedGross,
            projectedPortfolioGross,
        };
    };

    if (action.reduceOnly || requestedIncreaseUsd <= EPSILON) {
        const projection = buildProjection(Math.abs(action.targetNotionalUsd), requestedIncreaseUsd);
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
            availableMarginUsd,
            availableIncreaseCapacityUsd,
            grossIncreaseCapacityUsd,
            currentAccountGrossNotionalUsd,
            externalGrossNotionalUsd,
            managedGrossCap,
            portfolioGrossCap,
            targetInitialLeverage,
            maximumInitialMarginFraction,
            minimumAvailableBalanceAfterOrderUsd,
            ...projection,
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
            ? `${action.reason} Execution size was proportionally reduced to fixed 5x margin capacity, V96 sleeve Gross and combined portfolio Gross capacity.`
            : action.reason,
    };
    const projection = buildProjection(executionTargetNotionalAbsUsd, executableIncreaseUsd);
    if (projection.projectedManagedGross > managedGrossCap + EPSILON) {
        throw new Error(`V96 projected managed Gross ${projection.projectedManagedGross.toFixed(8)} exceeds ${managedGrossCap}; manual review is required.`);
    }
    if (projection.projectedPortfolioGross > portfolioGrossCap + EPSILON) {
        throw new Error(`V96 projected combined portfolio Gross ${projection.projectedPortfolioGross.toFixed(8)} exceeds ${portfolioGrossCap}; manual review is required.`);
    }
    if (projection.projectedInitialMarginFraction > maximumInitialMarginFraction + EPSILON) {
        throw new Error(`V96 projected initial-margin fraction ${projection.projectedInitialMarginFraction.toFixed(8)} exceeds ${maximumInitialMarginFraction}; manual review is required.`);
    }
    if (projection.projectedAvailableBalanceUsd + EPSILON < minimumAvailableBalanceAfterOrderUsd) {
        throw new Error("V96 projected available balance would fall below the protected combined-account reserve.");
    }
    const minimumOrderNotionalUsd = finiteNonNegative(config.minOrderNotionalUsd, "V96 minimum order notional");
    const blockedReason = executableIncreaseUsd + EPSILON < minimumOrderNotionalUsd
        ? `V96 executable increase ${executableIncreaseUsd.toFixed(4)} USD is below the minimum order notional after Cash Reserve, cost headroom, fixed leverage, margin, V96 sleeve Gross and combined portfolio Gross checks.`
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
        availableMarginUsd,
        availableIncreaseCapacityUsd,
        grossIncreaseCapacityUsd,
        currentAccountGrossNotionalUsd,
        externalGrossNotionalUsd,
        managedGrossCap,
        portfolioGrossCap,
        targetInitialLeverage,
        maximumInitialMarginFraction,
        minimumAvailableBalanceAfterOrderUsd,
        ...projection,
        wasScaled: executionScale + EPSILON < 1,
        blockedReason,
    };
}
