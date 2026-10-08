import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const DEFAULT_STATE = "/var/lib/disdex/v12-v4-shadow/state.json";
const DEFAULT_RELEASE = "/home/deploy/disdex-trading/current";
const CATALOG_RELATIVE = "docs/research/V12_MULTILOGIC_V4_ROUTE_CATALOG_20261009.json";
const MAX_BYTES = 2 * 1024 * 1024;

type Json = Record<string, unknown>;

export type V12V4ShadowRow = {
  route: string;
  family: string;
  symbol: string;
  sourceSide: string;
  effectiveSide: string;
  rank: number;
  requestedGross: number;
  postMinLiftGross?: number;
  decision: string;
  reason: string;
  plannedExitPolicy: string;
  entryDelayHours: number;
  entryRuleTokens: string[];
  features: Record<string, unknown>;
  virtualLegId?: string;
  preemptedVirtualLegIds?: string[];
  orderEnabled: false;
  shadow: true;
};

export type V12V4RouteCatalogRow = {
  route: string;
  family: string;
  entryRule: string;
  sideTransform: string;
  entryDelayHours: number;
  exitPolicy: string;
  grossPolicy: string;
  preemptionPolicy: string;
  metrics: Record<string, { trades: number; winRate: number; pf?: number; netPnlUsd: number }>;
};

export type V12V4ShadowObservability = {
  ok: true;
  readOnly: true;
  tradingMutation: 0;
  architecture: "MULTILOGIC_V4";
  shadow: true;
  orderEnabled: false;
  capturedAt?: string;
  stateAvailable: boolean;
  statePath: string;
  catalogAvailable: boolean;
  catalogPath: string;
  routeCount: number;
  caps: {
    recoveryRouteSlots: number;
    recoveryFamilyGross: number;
    normalRecoveryGross: number;
    robustMaxGross: number;
    minLiftMaxGross: number;
    v12Gross: number;
    cryptoGross: number;
    totalGross: number;
  };
  counts: {
    rawRouteSymbolEvaluations: number;
    independentlyQualifyingCandidates: number;
    admittedShadowVirtualLegs: number;
    rejectedShadowLegs: number;
    uniqueAdmittedSymbols: number;
    realOrderEnabledV4: 0;
  };
  candidates: V12V4ShadowRow[];
  accepted: V12V4ShadowRow[];
  rejected: V12V4ShadowRow[];
  aggregateBt: Record<string, { trades?: number; winRate?: number; pf?: number; netPnlUsd?: number; finalEquityJpy?: number; dd?: number }>;
  routeCatalog: V12V4RouteCatalogRow[];
  errors: string[];
};

function obj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Json : null;
}

function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function readJson(path: string) {
  const text = await readFile(path, "utf8");
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error("V12_V4_JSON_TOO_LARGE:" + path);
  return JSON.parse(text) as unknown;
}

function row(v: unknown): V12V4ShadowRow | null {
  const x = obj(v);
  if (!x) return null;
  if (x.orderEnabled !== false || x.shadow !== true) return null;
  return {
    route: String(x.route || ""),
    family: String(x.family || ""),
    symbol: String(x.symbol || ""),
    sourceSide: String(x.sourceSide || ""),
    effectiveSide: String(x.effectiveSide || ""),
    rank: num(x.rank, 99),
    requestedGross: num(x.requestedGross),
    postMinLiftGross: x.postMinLiftGross === undefined ? undefined : num(x.postMinLiftGross),
    decision: String(x.decision || ""),
    reason: String(x.reason || ""),
    plannedExitPolicy: String(x.plannedExitPolicy || ""),
    entryDelayHours: num(x.entryDelayHours),
    entryRuleTokens: Array.isArray(x.entryRuleTokens) ? x.entryRuleTokens.map(String) : [],
    features: obj(x.features) || {},
    virtualLegId: x.virtualLegId === undefined ? undefined : String(x.virtualLegId),
    preemptedVirtualLegIds: Array.isArray(x.preemptedVirtualLegIds) ? x.preemptedVirtualLegIds.map(String) : undefined,
    orderEnabled: false,
    shadow: true,
  };
}

export async function loadV12V4ShadowObservability(options: { statePath?: string; releaseRoot?: string } = {}): Promise<V12V4ShadowObservability> {
  const configured = String(options.statePath || process.env.V12_V4_SHADOW_STATE_PATH || DEFAULT_STATE).trim();
  const statePath = isAbsolute(configured) ? configured : DEFAULT_STATE;
  const releaseRoot = options.releaseRoot || DEFAULT_RELEASE;
  const catalogPath = join(releaseRoot, CATALOG_RELATIVE);
  const errors: string[] = [];

  let state: Json | null = null;
  try {
    const raw = await readJson(statePath);
    state = obj(raw);
    if (!state) errors.push("V12 V4 shadow state is not an object.");
    if (state?.orderEnabled !== false) errors.push("V12 V4 shadow safety: orderEnabled must be false.");
    if (num(state?.tradingMutation, -1) !== 0) errors.push("V12 V4 shadow safety: tradingMutation must be 0.");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "V12 V4 shadow state unavailable.");
  }

  let catalog: Json | null = null;
  try {
    catalog = obj(await readJson(catalogPath));
    if (!catalog) errors.push("V12 V4 route catalog is not an object.");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "V12 V4 route catalog unavailable.");
  }

  const architecture = obj(catalog?.architecture);
  const stateCaps = obj(state?.caps);
  const routeList = Array.isArray(catalog?.routes) ? catalog!.routes as unknown[] : [];
  const countsObj = obj(state?.counts);
  const candidates = (Array.isArray(state?.candidates) ? state!.candidates : []).map(row).filter((x): x is V12V4ShadowRow => Boolean(x));
  const accepted = (Array.isArray(state?.accepted) ? state!.accepted : []).map(row).filter((x): x is V12V4ShadowRow => Boolean(x));
  const rejected = (Array.isArray(state?.rejected) ? state!.rejected : []).map(row).filter((x): x is V12V4ShadowRow => Boolean(x));

  const routeCatalog: V12V4RouteCatalogRow[] = routeList.map((raw) => {
    const r = obj(raw) || {};
    const metrics: V12V4RouteCatalogRow["metrics"] = {};
    for (const label of ["10bps", "20bps", "30bps"]) {
      const trades = num(r[label + "_trades"]);
      const winRate = num(r[label + "_win_rate"]);
      const pfRaw = r[label + "_pf_usd"];
      metrics[label] = {
        trades,
        winRate,
        pf: pfRaw === null || pfRaw === undefined ? undefined : num(pfRaw),
        netPnlUsd: num(r[label + "_net_pnl_usd"]),
      };
    }
    return {
      route: String(r.route || ""),
      family: String(r.family || ""),
      entryRule: String(r.entry_rule_text || ""),
      sideTransform: String(r.side_transform || ""),
      entryDelayHours: num(r.entry_delay_h),
      exitPolicy: String(r.exit_policy || ""),
      grossPolicy: String(r.requested_gross_policy || ""),
      preemptionPolicy: String(r.opposite_preemption || ""),
      metrics,
    };
  });

  const aggregateBt: V12V4ShadowObservability["aggregateBt"] = {};
  const aggregate = obj(catalog?.aggregate);
  for (const [scenario, raw] of Object.entries(aggregate || {})) {
    const s = obj(raw); const v12 = obj(s?.v12); const portfolio = obj(s?.portfolio);
    aggregateBt[scenario] = {
      trades: v12 ? num(v12.trades) : undefined,
      winRate: v12 ? num(v12.win_rate) : undefined,
      pf: v12 ? num(v12.pf_usd) : undefined,
      netPnlUsd: v12 ? num(v12.net_pnl_usd) : undefined,
      finalEquityJpy: portfolio ? num(portfolio.final_equity_jpy) : undefined,
      dd: portfolio ? num(portfolio.maximum_mtm_drawdown) : undefined,
    };
  }

  const caps = {
    recoveryRouteSlots: num(stateCaps?.recoveryRouteSlots ?? architecture?.recovery_route_slots, 16),
    recoveryFamilyGross: num(stateCaps?.recoveryFamilyGross ?? architecture?.recovery_family_gross_cap, 1),
    normalRecoveryGross: num(stateCaps?.normalRecoveryGross ?? architecture?.normal_recovery_gross, 0.1),
    robustMaxGross: num(stateCaps?.robustMaxGross ?? architecture?.robust_complement_max_gross, 0.25),
    minLiftMaxGross: num(stateCaps?.minLiftMaxGross ?? architecture?.minlift_max_gross, 0.3),
    v12Gross: num(stateCaps?.v12Gross ?? architecture?.v12_total_gross_cap, 2),
    cryptoGross: num(stateCaps?.cryptoGross ?? architecture?.crypto_gross_cap, 3),
    totalGross: num(stateCaps?.totalGross ?? architecture?.total_gross_cap, 4.25),
  };

  return {
    ok: true,
    readOnly: true,
    tradingMutation: 0,
    architecture: "MULTILOGIC_V4",
    shadow: true,
    orderEnabled: false,
    capturedAt: state?.capturedAt === undefined ? undefined : String(state.capturedAt),
    stateAvailable: Boolean(state && state.orderEnabled === false && num(state.tradingMutation, -1) === 0),
    statePath,
    catalogAvailable: Boolean(catalog),
    catalogPath,
    routeCount: routeList.length,
    caps,
    counts: {
      rawRouteSymbolEvaluations: num(countsObj?.rawRouteSymbolEvaluations),
      independentlyQualifyingCandidates: num(countsObj?.independentlyQualifyingCandidates),
      admittedShadowVirtualLegs: num(countsObj?.admittedShadowVirtualLegs),
      rejectedShadowLegs: num(countsObj?.rejectedShadowLegs),
      uniqueAdmittedSymbols: num(countsObj?.uniqueAdmittedSymbols),
      realOrderEnabledV4: 0,
    },
    candidates,
    accepted,
    rejected,
    aggregateBt,
    routeCatalog,
    errors,
  };
}
