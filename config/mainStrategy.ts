import { DISDEX_RESILIENT_PROFIT_MAIN_V35 } from "@/lib/disdex-resilient-profit-main-v35";

/**
 * Repository-level Dis-Dex main strategy implementation.
 *
 * The dedicated Aster long/short portfolio runner is implemented. Production
 * execution remains blocked because PENGU V36/V38 and Aster core-only V37 did
 * not pass the robust promotion gates. Run the V35 daemon in PAPER mode only.
 */
export const ACTIVE_MAIN_STRATEGY = DISDEX_RESILIENT_PROFIT_MAIN_V35;
export const ACTIVE_MAIN_STRATEGY_MODE = "PAPER" as const;
export const ACTIVE_MAIN_STRATEGY_REAL_TRADING_ENABLED = false as const;
