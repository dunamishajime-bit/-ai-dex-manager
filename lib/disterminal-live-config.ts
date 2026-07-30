export const DIST_TERMINAL_LIVE_CONFIG = {
  productName: "DISTerminal",
  strategyLabel: "V96 Crypto + V52 Stock 統合LIVE",
  executionVenue: "AsterDEX",
  executor: "AsterDirectTradeExecutor",
  approvedReleaseSha: "52bad2e37217ea1431d46648090f3bf3d8b20c1e",
  v96DailyLossPct: 5,
  v52DailyLossPct: 3.5,
  maximumGross: 1,
  penguInitialGross: 0.15,
  cryptoSymbols: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"],
  stockSymbols: ["AMZNUSDT", "METAUSDT", "MSFTUSDT", "NVDAUSDT", "TSLAUSDT"],
} as const;
