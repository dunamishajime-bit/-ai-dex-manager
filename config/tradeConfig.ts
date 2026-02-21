// tradeConfig.ts
// 動的な制約・ロジック用: チェーン・通貨・口座資金ルールを一元管理します。

export type SupportedChain = "BNB" | "POLYGON";

export const TRADE_CONFIG = {
    // 実際にトレードを行う対象となるチェーン
    SUPPORTED_CHAINS: ["BNB", "POLYGON"] as SupportedChain[],

    // 自動トレードなどで許容される初期資金通貨 (ボラティリティペア生成対象にはならない)
    // これらはデモ口座の `cashbalance` として扱われます
    ALLOWED_START_FUNDS: ["USDT", "USDC", "USD1", "BNB", "BTC", "SOL", "POL"],

    // デモモード開始時に提供される初期残高のハードコード設定
    // ※これらはデモトレード専用の仮想的な資産です。
    DEMO_FUNDS: {
        "100_USDT": { symbol: "USDT", amount: 100 },
        "300_USD1": { symbol: "USD1", amount: 300 },
        "100_USDC": { symbol: "USDC", amount: 100 },
        "10_BNB": { symbol: "BNB", amount: 10 },
        "1_BTC": { symbol: "BTC", amount: 1 },
        "50_SOL": { symbol: "SOL", amount: 50 },
        "1000_POL": { symbol: "POL", amount: 1000 },
    },

    // 以下の通貨はボラティリティ・トレード（AIによるポジション取得）の対象外とします
    // つまり、「ステーブルコイン同士の取引」や「ステーブルコインを積極的に買う取引」を禁止します
    STABLECOINS: ["USDT", "USDC", "DAI", "BUSD", "FDUSD", "TUSD", "USDP", "USD1", "USD", "JPY"],

    // トレード不可にするトークンの末尾のシンボル
    FORBIDDEN_SUFFIXES: ["USD", "JPY"],

    // デモトレード時の1回あたりの最大取引量（保有残高の割合 or 固定値）
    MAX_TRADE_SIZE_PERCENT: 50, // 最大でも利用可能資金の50%

    // 以下の関数でトークンが「ボラティリティトレード対象」として適切か判定します
    isTradeableVolatilityToken: (symbol: string) => {
        const upper = symbol.toUpperCase();
        if (TRADE_CONFIG.STABLECOINS.includes(upper)) return false;
        if (TRADE_CONFIG.FORBIDDEN_SUFFIXES.some(suffix => upper.endsWith(suffix))) return false;
        if (upper.includes("-")) return false; // LP Token等の除外
        if (["WETH", "WBTC", "BTC"].includes(upper)) return false; // ラップドトークンおよびBTCを一時的に除外

        // それ以外はすべて取引対象となり得るとします
        return true;
    }
};
