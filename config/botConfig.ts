export const BOT_CONFIG = {
    LOOP_MS: 3500,
    MAX_PARALLEL_QUOTES: 6,

    // Lane A (Intra-chain rotation)
    LANE_A: {
        MIN_PNL_PCT: 0.25,
        SIZE_PCT: 3.0,
        MIN_USD: 15,
        MAX_USD: 120,
        MEV_MARGIN_PCT: 0.15,
        FAILURE_BUFFER_PCT: 0.10,
    },

    // Lane B (Sniping thin pairs)
    LANE_B: {
        MIN_PNL_PCT: 0.90,
        SIZE_PCT: 1.5,
        MIN_USD: 10,
        MAX_USD: 60,
        MEV_MARGIN_PCT: 0.60,
        FAILURE_BUFFER_PCT: 0.10,
    },

    // Slippage (BPS)
    SLIPPAGE: {
        BNB_USDT: 40,
        BNB_USD1: 60,
        WLFI_USD1: 150,
        ASTER_USD1: 150,
    },

    // Safety Flags
    ENABLE_BSC: true,
    ENABLE_POLYGON: false,
    ENABLE_CROSS_CHAIN: false,

    // Risk Guard
    STOP_LOSS_MOVING_SUM_PCT: -1.0,
    WIN_LOSS_SAMPLES: 10,
    COOLDOWN_MS_DRAWDOWN: 30 * 60 * 1000,
    LANE_B_STOP_LOSES: 3,
    COOLDOWN_MS_LANE_B: 60 * 60 * 1000,
} as const;
