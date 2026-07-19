import { DISDEX_RESILIENT_PROFIT_MAIN_V35 } from "@/lib/disdex-resilient-profit-main-v35";

/**
 * Repository-level promoted main strategy.
 *
 * The legacy WIN80 runner remains a separate runtime and must not be relabelled
 * as V35. V35 is promoted in SHADOW mode only until a dedicated portfolio
 * runner supports its long/short core and PENGU sleeve and passes fresh forward
 * evidence.
 */
export const ACTIVE_MAIN_STRATEGY = DISDEX_RESILIENT_PROFIT_MAIN_V35;
export const ACTIVE_MAIN_STRATEGY_MODE = "SHADOW" as const;
export const ACTIVE_MAIN_STRATEGY_REAL_TRADING_ENABLED = false as const;
