import { DISDEX_PENGU_DUAL_ENGINE_V46, DISDEX_V46_RUNTIME } from "@/config/disdexV46Runtime";
import { DISDEX_RESILIENT_PROFIT_MAIN_V35 } from "@/lib/disdex-resilient-profit-main-v35";

/**
 * Repository-level Dis-Dex strategy stack.
 *
 * V35 remains the ETH/BNB/SOL Bull core and BTC Bear hedge. PENGU V46 is the
 * independent Long/Short profit engine. The combined V46 runner owns target
 * weights, gross-cap enforcement and one-way direction changes.
 *
 * Both engines remain PAPER_FORWARD. Production order execution is blocked
 * until a separate reviewed promotion changes the immutable live flags.
 */
export const ACTIVE_MAIN_STRATEGY = DISDEX_RESILIENT_PROFIT_MAIN_V35;
export const ACTIVE_PENGU_ENGINE = DISDEX_PENGU_DUAL_ENGINE_V46;
export const ACTIVE_PORTFOLIO_RUNNER_ID = DISDEX_V46_RUNTIME.strategyId;
export const ACTIVE_MAIN_STRATEGY_MODE = "PAPER" as const;
export const ACTIVE_MAIN_STRATEGY_REAL_TRADING_ENABLED = false as const;
