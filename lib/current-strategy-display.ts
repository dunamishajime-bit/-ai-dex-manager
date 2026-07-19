export const CURRENT_DISDEX_STRATEGY = {
  id: "DISDEX_V35_CORE_PLUS_PENGU_DUAL_V46",
  name: "Dis-Dex Manager V35 Core + PENGU V46",
  mode: "LIVE",
  venue: "AsterDEX",
  managedSymbols: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"],
  maximumGross: 2,
  cashReservePct: 2,
  penguLongGross: 0.15,
  penguShortGross: 0.15,
  penguFundingCap: 0.0003,
  closeUnmanagedPositions: false,
  pristineForwardEvidence: false,
  livePromotionBasis: "MANUAL_OPERATOR_OVERRIDE",
  evidenceNotice:
    "PENGU V46のpristine forward evidenceは未完了です。LIVE運用は明示的な手動承認に基づきます。",
  safetyControls: [
    "LIVE二重ゲート",
    "口座単位ロック・One-way Mode確認",
    "durable state照合とrecovery-only起動",
    "市場データ鮮度・equity・Gross再検査",
    "管理外銘柄を自動決済しない",
  ],
} as const;

export type CurrentStrategyPosition = {
  symbol: string;
  quantity: number;
  positionSide: string;
  notionalUsd: number;
  entryPrice: number;
  markPrice: number;
  updatedAt: number;
};

export type CurrentStrategyStatusResponse = {
  ok: boolean;
  strategy: typeof CURRENT_DISDEX_STRATEGY;
  runner: {
    mode: "LIVE";
    active: boolean;
    status: "active" | "stale" | "unavailable";
    stateUpdatedAt: number | null;
    lastRunAt: number | null;
    recoveryStatus: string;
    recoveryReason: string | null;
  };
  account: {
    walletBalance: number | null;
    availableBalance: number | null;
    equity: number | null;
    currentGross: number | null;
  };
  positions: CurrentStrategyPosition[];
  safety: {
    openOrderCount: number | null;
    pendingUnknown: boolean;
    failures: string[];
  };
  source: "v46-durable-state" | "unavailable";
  generatedAt: number;
};

