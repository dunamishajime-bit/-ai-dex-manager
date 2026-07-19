import { DISDEX_PENGU_DUAL_ENGINE_V46, DISDEX_V46_RUNTIME } from "@/config/disdexV46Runtime";
import { DISDEX_RESILIENT_PROFIT_MAIN_V35 } from "@/lib/disdex-resilient-profit-main-v35";

/**
 * Repository-level Dis-Dex strategy stack.
 *
 * V35 remains the ETH/BNB/SOL Bull core and BTC Bear hedge. PENGU V46 is the
 * independent Long/Short profit engine. The combined V46 runner owns target
 * weights, gross-cap enforcement and one-way direction changes.
 *
 * V35 Core plus PENGU V46 is operated LIVE only after explicit manual
 * operator approval. PENGU pristine Forward Evidence is incomplete and this
 * promotion does not represent a research pass or a robust holdout result.
 */
export const ACTIVE_MAIN_STRATEGY = DISDEX_RESILIENT_PROFIT_MAIN_V35;
export const ACTIVE_PENGU_ENGINE = DISDEX_PENGU_DUAL_ENGINE_V46;
export const ACTIVE_PORTFOLIO_RUNNER_ID = DISDEX_V46_RUNTIME.strategyId;
export const ACTIVE_MAIN_STRATEGY_MODE = "LIVE" as const;
export const ACTIVE_MAIN_STRATEGY_REAL_TRADING_ENABLED = true as const;
