import fs from "fs";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "auto-trade-runtime-control.json");

export type AutoTradeActiveStrategy =
  | "legacy_paused"
  | "combined_dry_run"
  | "combined_live";

export type AutoTradeRuntimeControl = {
  tradingPaused: boolean;
  pausedAt: string | null;
  pauseReason: string | null;
  updatedAt: string;
  activeStrategy: AutoTradeActiveStrategy;
  nextStrategy: {
    venue: string;
    mode: string;
    timeframe: string;
    symbols: string[];
    references: string[];
  } | null;
  combined?: {
    venue: "AsterDex";
    executionSymbol: string;
    referenceSignal: string;
    marketSymbol: string;
    mode: "dry_run" | "live";
  };
};

const DEFAULT_CONTROL: AutoTradeRuntimeControl = {
  tradingPaused: false,
  pausedAt: null,
  pauseReason: null,
  updatedAt: new Date(0).toISOString(),
  activeStrategy: "legacy_paused",
  nextStrategy: null,
  combined: undefined,
};

function normalizeActiveStrategy(value: unknown): AutoTradeActiveStrategy {
  if (value === "combined_dry_run" || value === "combined_live" || value === "legacy_paused") {
    return value;
  }
  return DEFAULT_CONTROL.activeStrategy;
}

export function loadAutoTradeRuntimeControl(): AutoTradeRuntimeControl {
  try {
    if (!fs.existsSync(DB_PATH)) return DEFAULT_CONTROL;
    const raw = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AutoTradeRuntimeControl>;

    return {
      tradingPaused: parsed.tradingPaused === true,
      pausedAt: typeof parsed.pausedAt === "string" ? parsed.pausedAt : null,
      pauseReason: typeof parsed.pauseReason === "string" ? parsed.pauseReason : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : DEFAULT_CONTROL.updatedAt,
      activeStrategy: normalizeActiveStrategy(parsed.activeStrategy),
      nextStrategy: parsed.nextStrategy && typeof parsed.nextStrategy === "object"
        ? {
            venue: String(parsed.nextStrategy.venue || ""),
            mode: String(parsed.nextStrategy.mode || ""),
            timeframe: String(parsed.nextStrategy.timeframe || ""),
            symbols: Array.isArray(parsed.nextStrategy.symbols) ? parsed.nextStrategy.symbols.map(String) : [],
            references: Array.isArray(parsed.nextStrategy.references) ? parsed.nextStrategy.references.map(String) : [],
          }
        : null,
      combined: parsed.combined && typeof parsed.combined === "object"
        ? {
            venue: "AsterDex",
            executionSymbol: String(parsed.combined.executionSymbol || "PENGU/USDT"),
            referenceSignal: String(parsed.combined.referenceSignal || "BTC 15m GoldCat"),
            marketSymbol: String(parsed.combined.marketSymbol || "PENGUUSDT"),
            mode: parsed.combined.mode === "live" ? "live" : "dry_run",
          }
        : undefined,
    };
  } catch (error) {
    console.warn("[auto-trade-runtime-control] failed to read control file:", error);
    return DEFAULT_CONTROL;
  }
}

export function saveAutoTradeRuntimeControl(control: AutoTradeRuntimeControl) {
  const next: AutoTradeRuntimeControl = {
    ...control,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function isAutoTradePaused() {
  const control = loadAutoTradeRuntimeControl();
  return {
    paused: control.tradingPaused,
    reason: control.pauseReason || "自動売買は停止中です。",
    control,
  };
}

export function isCombinedStrategyActive(control = loadAutoTradeRuntimeControl()) {
  return control.activeStrategy === "combined_dry_run" || control.activeStrategy === "combined_live";
}
