#!/usr/bin/env python3
"""Promote Win80/Ultra90 router into the production strategy path.

Idempotently patches the existing large strategy/runtime files. The GitHub
Actions workflow runs tests and production build before committing the patch.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def patch_package_json() -> None:
    path = ROOT / "package.json"
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    scripts = payload.setdefault("scripts", {})
    scripts["strategy:main:selftest"] = "tsx scripts/win80-ultra90-main-selftest.ts"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def patch_strategy_config() -> None:
    path = ROOT / "config/strategyConfig.ts"
    text = path.read_text(encoding="utf-8-sig")
    replacements = {
        "    SCORE_THRESHOLD_A: 74,": "    SCORE_THRESHOLD_A: 80,",
        "    MAX_SELECTED_PER_CYCLE: 10,": "    MAX_SELECTED_PER_CYCLE: 1,",
        "    MAX_SELECTED_CANDIDATES: 16,": "    MAX_SELECTED_CANDIDATES: 1,",
        "    MAX_SELECTED_PER_CORRELATION_GROUP: 5,": "    MAX_SELECTED_PER_CORRELATION_GROUP: 1,",
        "    AUTO_TRADE_REVIEW_REQUIRE_PROFIT_BEFORE_ROTATION: false,": "    AUTO_TRADE_REVIEW_REQUIRE_PROFIT_BEFORE_ROTATION: true,",
        "    AUTO_TRADE_REVIEW_MAX_ACTIVE_SYMBOLS: 4,": "    AUTO_TRADE_REVIEW_MAX_ACTIVE_SYMBOLS: 2,",
        "    AUTO_TRADE_TREND_PARTIAL_TP_FRACTION: 0.45,": "    AUTO_TRADE_TREND_PARTIAL_TP_FRACTION: 0.5,",
        "    REPLACEMENT_PRIORITY_BUFFER: 8,": "    REPLACEMENT_PRIORITY_BUFFER: 10,",
        "    FULL_SIZE_POSITION_MULTIPLIER: 0.5,": "    FULL_SIZE_POSITION_MULTIPLIER: 1,",
        "    HALF_SIZE_POSITION_MULTIPLIER: 0.3,": "    HALF_SIZE_POSITION_MULTIPLIER: 0.5,",
        "    PROBATION_POSITION_MULTIPLIER: 0.2,": "    PROBATION_POSITION_MULTIPLIER: 0.3,",
    }
    for old, new in replacements.items():
        if new not in text:
            if old not in text:
                raise RuntimeError(f"strategyConfig missing: {old}")
            text = text.replace(old, new, 1)

    marker = "    EXCLUDE_STABLECOINS: true,"
    additions = """    MAIN_STRATEGY_ENABLED: true,
    MAIN_STRATEGY_ID: \"WIN80_ULTRA90_TOP1_V1\",
    MAIN_STRATEGY_REAL_TRADING_ENABLED: false,
    MAIN_STRATEGY_INITIAL_NOTIONAL_FRACTION: 1,
    MAIN_STRATEGY_MAX_CONCURRENT_POSITIONS: 2,
    MAIN_STRATEGY_PROFITABLE_OVERLAP_SPLIT_FRACTION: 0.5,
    MAIN_STRATEGY_ULTRA90_SWITCH_FRACTION: 0.7,
    MAIN_STRATEGY_MIN_SCORE: 80,
    MAIN_STRATEGY_ULTRA_SCORE: 90,
    MAIN_STRATEGY_DISABLE_EMERGENCY_TOPUP: true,
"""
    if "MAIN_STRATEGY_ID" not in text:
        if marker not in text:
            raise RuntimeError("strategyConfig insertion marker missing")
        text = text.replace(marker, additions + marker, 1)
    path.write_text(text, encoding="utf-8")


def patch_cycle_strategy() -> None:
    path = ROOT / "lib/cycle-strategy.ts"
    text = path.read_text(encoding="utf-8-sig")
    import_marker = 'import { isAutoTradeExcludedExecutionTarget } from "@/lib/proxy-assets";\n'
    import_line = 'import { applyWin80Ultra90Top1Selection } from "@/lib/win80-ultra90-main-strategy";\n'
    if import_line not in text:
        if import_marker not in text:
            raise RuntimeError("cycle-strategy import marker missing")
        text = text.replace(import_marker, import_marker + import_line, 1)

    old_selection = """    let selected = selectContinuousCandidatesV2(
        enriched,
        correlations,
        { prefilterMode, prefilterPassCount: effectivePrefilterUniverse.length },
    );
"""
    new_selection = """    let selected = STRATEGY_CONFIG.MAIN_STRATEGY_ENABLED
        ? applyWin80Ultra90Top1Selection(enriched)
        : selectContinuousCandidatesV2(
            enriched,
            correlations,
            { prefilterMode, prefilterPassCount: effectivePrefilterUniverse.length },
        );
"""
    text = replace_once(text, old_selection, new_selection, "cycle main selection")

    selection_index = text.index(new_selection)
    emergency_old = "    if (selected.length < minimumTargetSelected) {"
    emergency_new = "    if (!STRATEGY_CONFIG.MAIN_STRATEGY_DISABLE_EMERGENCY_TOPUP && selected.length < minimumTargetSelected) {"
    after = text[selection_index:]
    if emergency_new not in after:
        relative = after.find(emergency_old)
        if relative < 0:
            raise RuntimeError("cycle emergency top-up marker missing")
        absolute = selection_index + relative
        text = text[:absolute] + emergency_new + text[absolute + len(emergency_old):]

    path.write_text(text, encoding="utf-8")


def patch_simulation_context() -> None:
    path = ROOT / "context/SimulationContext.tsx"
    text = path.read_text(encoding="utf-8-sig")

    import_marker = """import {
    getProxyExecutionAssetLabel,
    normalizeExecutionTarget,
} from \"@/lib/proxy-assets\";
"""
    import_line = """import {
    classifyMainStrategyCandidate,
    resolveWin80Ultra90Overlap,
} from \"@/lib/win80-ultra90-main-strategy\";
"""
    if import_line not in text:
        if import_marker not in text:
            raise RuntimeError("SimulationContext import marker missing")
        text = text.replace(import_marker, import_marker + import_line, 1)

    live_tick_marker = "        const runLiveAutoTick = async () => {\n"
    live_tick_guard = """        const runLiveAutoTick = async () => {
            if (
                STRATEGY_CONFIG.MAIN_STRATEGY_ENABLED
                && !STRATEGY_CONFIG.MAIN_STRATEGY_REAL_TRADING_ENABLED
                && !isDemoMode
            ) {
                emitLiveAutoStatus(\"hold: Win80/Ultra90 main strategy live trading disabled\", {
                    strategyId: STRATEGY_CONFIG.MAIN_STRATEGY_ID,
                    paperOnly: true,
                });
                return;
            }
"""
    text = replace_once(text, live_tick_marker, live_tick_guard, "live trading safety guard")

    old_slots = """            const desiredBasketSlots = Math.min(
                STRATEGY_CONFIG.MAX_SELECTED_CANDIDATES + 4,
                Math.max(
                    liveMonitor.selected.length,
                    selectedBasketCap + (liveMonitor.stats.prefilterMode === \"Range\" ? 2 : 1),
                ),
            );
"""
    new_slots = """            const desiredBasketSlots = STRATEGY_CONFIG.MAIN_STRATEGY_ENABLED
                ? STRATEGY_CONFIG.MAIN_STRATEGY_MAX_CONCURRENT_POSITIONS
                : Math.min(
                    STRATEGY_CONFIG.MAX_SELECTED_CANDIDATES + 4,
                    Math.max(
                        liveMonitor.selected.length,
                        selectedBasketCap + (liveMonitor.stats.prefilterMode === \"Range\" ? 2 : 1),
                    ),
                );
"""
    text = replace_once(text, old_slots, new_slots, "main strategy basket slots")

    text = replace_once(
        text,
        "            const supplementalPlans = freeEntrySlots > 0\n",
        "            const supplementalPlans = !STRATEGY_CONFIG.MAIN_STRATEGY_ENABLED && freeEntrySlots > 0\n",
        "disable supplemental filler plans",
    )

    old_ready = """            const readyPlans = basketPlans
                .filter((plan) => plan.orderArmEligible || plan.triggerState === \"Triggered\")
                .sort((left, right) => scoreLiveOrderPlan(right) - scoreLiveOrderPlan(left));
"""
    new_ready = """            const readyPlans = basketPlans
                .filter((plan) => plan.orderArmEligible || plan.triggerState === \"Triggered\")
                .sort((left, right) => scoreLiveOrderPlan(right) - scoreLiveOrderPlan(left));
            const resolveMainStrategyRotation = (plan: ReturnType<typeof buildOrderPlan>) => {
                if (!STRATEGY_CONFIG.MAIN_STRATEGY_ENABLED) return null;
                const incoming = candidateMap.get(normalizeTrackedSymbol(plan.symbol));
                if (!incoming) return null;
                const current = [...reviewOpenPositions]
                    .filter((position) => position.comparableSymbol !== comparableTradeSymbol(plan.symbol))
                    .sort((left, right) => right.usdValue - left.usdValue)[0];
                return resolveWin80Ultra90Overlap({
                    current: current ? {
                        symbol: current.symbol,
                        pnlPct: current.pnlPct,
                        usdValue: current.usdValue,
                    } : null,
                    incoming,
                });
            };
"""
    text = replace_once(text, old_ready, new_ready, "rotation resolver")

    funding_old = """                const funding = pickFundingSourceForBuy(symbol, desiredUsd, currentPortfolio, { minOrderUsd });
                if (funding.budgetUsd + 0.000001 < minOrderUsd) {
"""
    funding_new = """                const baseFunding = pickFundingSourceForBuy(symbol, desiredUsd, currentPortfolio, { minOrderUsd });
                const overlapDecision = resolveMainStrategyRotation(plan);
                const rotationPosition = overlapDecision && (overlapDecision.action === \"SPLIT_50\" || overlapDecision.action === \"SWITCH_70\")
                    ? [...reviewOpenPositions]
                        .filter((position) => position.comparableSymbol !== comparableSymbol)
                        .sort((left, right) => right.usdValue - left.usdValue)[0]
                    : undefined;
                if (overlapDecision?.action === \"REJECT\") {
                    setOrderDiagnostic(symbol, \"blocked\", \"Win80 overlap rejected\", overlapDecision.reason);
                    continue;
                }
                if (overlapDecision?.action === \"HOLD_SAME\") {
                    setOrderDiagnostic(symbol, \"blocked\", \"Same symbol already managed\", overlapDecision.reason);
                    continue;
                }
                const funding = rotationPosition && overlapDecision
                    ? {
                        ...baseFunding,
                        sourceSymbol: rotationPosition.symbol,
                        budgetUsd: Math.max(
                            minOrderUsd,
                            Math.min(desiredUsd, rotationPosition.usdValue * overlapDecision.sourceSellFraction),
                        ),
                    }
                    : baseFunding;
                if (funding.budgetUsd + 0.000001 < minOrderUsd) {
"""
    text = replace_once(text, funding_old, funding_new, "overlap funding rotation")

    reason_old = """                const buyReason =
                    funding.sourceSymbol && !TRADE_CONFIG.STABLECOINS.includes(funding.sourceSymbol)
                        ? `常時監視: ${plan.triggerType} 発火で ${basketLabel} を基準に ${symbol} を${modeLabel}で買い。資金再配分 ${funding.sourceSymbol}→${symbol}${plan.orderSource === \"supplemental\" ? \" / free slot promotion\" : \"\"} / ${preTradeReview.strategy || \"AIレビュー反映\"}`
                        : `常時監視: ${plan.triggerType} 発火で ${basketLabel} を基準に ${symbol} を${modeLabel}で買い${plan.orderSource === \"supplemental\" ? \" / free slot promotion\" : \"\"} / ${preTradeReview.strategy || \"AIレビュー反映\"}`;
"""
    reason_new = """                const overlapLabel = overlapDecision
                    ? ` / ${overlapDecision.action}: ${overlapDecision.reason}`
                    : \"\";
                const buyReason =
                    funding.sourceSymbol && !TRADE_CONFIG.STABLECOINS.includes(funding.sourceSymbol)
                        ? `常時監視: ${plan.triggerType} 発火で ${basketLabel} を基準に ${symbol} を${modeLabel}で買い。資金再配分 ${funding.sourceSymbol}→${symbol}${plan.orderSource === \"supplemental\" ? \" / free slot promotion\" : \"\"}${overlapLabel} / ${preTradeReview.strategy || \"AIレビュー反映\"}`
                        : `常時監視: ${plan.triggerType} 発火で ${basketLabel} を基準に ${symbol} を${modeLabel}で買い${plan.orderSource === \"supplemental\" ? \" / free slot promotion\" : \"\"}${overlapLabel} / ${preTradeReview.strategy || \"AIレビュー反映\"}`;
"""
    text = replace_once(text, reason_old, reason_new, "overlap audit reason")

    context_marker = """                const shouldConsolidate =
                    (latestBuyTs > 0 && now >= latestBuyTs + (STRATEGY_CONFIG.AUTO_TRADE_BASKET_EXIT_MIN_HOLD_MINUTES * 60_000) && pnlPct >= STRATEGY_CONFIG.AUTO_TRADE_BASKET_EXIT_MIN_PROFIT_PCT)
"""
    context_new = """                const incomingMainCandidate = STRATEGY_CONFIG.MAIN_STRATEGY_ENABLED
                    ? basketPlans
                        .map((incomingPlan) => candidateMap.get(normalizeTrackedSymbol(incomingPlan.symbol)))
                        .find((incoming): incoming is ContinuousStrategyCandidate => Boolean(incoming) && comparableTradeSymbol(incoming!.symbol) !== comparableTradeSymbol(symbol))
                    : undefined;
                if (incomingMainCandidate) {
                    const overlapDecision = resolveWin80Ultra90Overlap({
                        current: { symbol, pnlPct, usdValue },
                        incoming: incomingMainCandidate,
                    });
                    if (overlapDecision.action === \"SPLIT_50\" || overlapDecision.action === \"SWITCH_70\" || overlapDecision.action === \"REJECT\") {
                        emitLiveAutoStatus(\"hold: main strategy overlap handled by direct rotation\", {
                            symbol,
                            incoming: incomingMainCandidate.symbol,
                            action: overlapDecision.action,
                            incomingTier: classifyMainStrategyCandidate(incomingMainCandidate),
                            pnlPct,
                        });
                        continue;
                    }
                }

                const shouldConsolidate =
                    (latestBuyTs > 0 && now >= latestBuyTs + (STRATEGY_CONFIG.AUTO_TRADE_BASKET_EXIT_MIN_HOLD_MINUTES * 60_000) && pnlPct >= STRATEGY_CONFIG.AUTO_TRADE_BASKET_EXIT_MIN_PROFIT_PCT)
"""
    text = replace_once(text, context_marker, context_new, "prevent full consolidation before overlap rotation")

    path.write_text(text, encoding="utf-8")


def main() -> None:
    patch_package_json()
    patch_strategy_config()
    patch_cycle_strategy()
    patch_simulation_context()
    print("WIN80_ULTRA90_MAIN_PATCH_OK")


if __name__ == "__main__":
    main()
