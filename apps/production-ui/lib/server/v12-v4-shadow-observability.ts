import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { createHash } from "node:crypto";
import { loadCurrentProductionRuntime } from "./current-production-runtime";

const DEFAULT_STATE = "/var/lib/disdex/v12-v4-shadow/state.json";
const DEFAULT_RELEASE = "/home/deploy/disdex-trading/current";
const CATALOG_RELATIVE = "docs/research/V12_MULTILOGIC_V4_ROUTE_CATALOG_20261009.json";
const MIDPOINT_PRIORITY_RELATIVE = "docs/implementation/v12-v4-v2-full-year-priority.json";
const MIDPOINT_ID = "V2_M150_D05_CORE_NATIVE";
const MAX_BYTES = 2 * 1024 * 1024;

type Json = Record<string, unknown>;
const MAX_AGE_MS = 3 * 60 * 60 * 1000;
// Git stores LF; the audited Windows source uses CRLF (raw SHA256 30f896...bb4d5).
// Normalize only line endings so Linux and Windows verify the same frozen bytes.
const PRIORITY_SHA256 = "bae4573f6ff516bec2b27e7e10d35e5027c7265c67bbdb101c1038066b5f7c27";

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
  midpointTier?: string;
  midpointRank?: number;
  midpointGross?: number;
  midpointTrainCount?: number;
  midpointScore?: number;
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
  observedPolicyId?: string;
  midpointPriorityAvailable: boolean;
  midpointPromotionStatus: "BLOCKED_HINDSIGHT_LEAKAGE_AND_EXTERNAL_Y06";
  midpointBt: Record<"10bps" | "20bps" | "30bps", { finalEquityJpy: number; dd: number }>;
  midpointCaps: { recoveryFamilyGross: number; v12Gross: number; cryptoGross: number; totalGross: number };
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
  certification: { status: "BLOCKED_PRODUCTION_PARITY"; orderAuthority: false; eightSystemParity: "NOT_PROVEN"; certificateVerified: false; blockers: string[] };
  runtimeObservation: { checkedAt: string; releaseSha?: string; runnerStatus: "OBSERVED" | "STALE" | "UNAVAILABLE"; runnerUpdatedAt?: number; mode?: string; safetyState?: string; killSwitchActive?: boolean; killSwitchAction?: string; killSwitchReason?: string; caps?: { v12Gross: number; cryptoGross: number; totalGross: number }; error?: string; orderAuthority: false };
  shadowFresh: boolean;
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
  if (typeof x.route !== "string" || !x.route || typeof x.symbol !== "string" || !x.symbol) return null;
  if (typeof x.requestedGross !== "number" || !Number.isFinite(x.requestedGross) || x.requestedGross < 0) return null;
  if (x.postMinLiftGross !== undefined && (typeof x.postMinLiftGross !== "number" || !Number.isFinite(x.postMinLiftGross) || x.postMinLiftGross < 0)) return null;
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

export async function loadV12V4ShadowObservability(options: { statePath?: string; releaseRoot?: string; now?: number; killSwitchPath?: string } = {}): Promise<V12V4ShadowObservability> {
  const configured = String(options.statePath || process.env.V12_V4_SHADOW_STATE_PATH || DEFAULT_STATE).trim();
  const statePath = isAbsolute(configured) ? configured : DEFAULT_STATE;
  const releaseRoot = options.releaseRoot || DEFAULT_RELEASE;
  const catalogPath = join(releaseRoot, CATALOG_RELATIVE);
  const midpointPriorityPath = join(releaseRoot, MIDPOINT_PRIORITY_RELATIVE);
  const errors: string[] = [];
  const now = options.now ?? Date.now();
  let runtimeObservation: V12V4ShadowObservability["runtimeObservation"] = { checkedAt: new Date(now).toISOString(), runnerStatus: "UNAVAILABLE", orderAuthority: false };
  try {
    const runtime = await loadCurrentProductionRuntime();
    const unit = runtime.runtimeLineage.units.v12;
    const fresh = unit.updatedAt !== undefined && now - unit.updatedAt >= -60000 && now - unit.updatedAt <= MAX_AGE_MS;
    runtimeObservation = { ...runtimeObservation, releaseSha: runtime.releaseSha, runnerStatus: fresh && unit.matchesCurrent ? "OBSERVED" : "STALE", runnerUpdatedAt: unit.updatedAt, mode: unit.mode, safetyState: unit.safetyState, caps: { v12Gross: runtime.caps.v12DynamicGross, cryptoGross: runtime.caps.cryptoGross, totalGross: runtime.caps.totalGross } };
  } catch (error) { runtimeObservation.error = error instanceof Error ? error.message : "CURRENT_RUNTIME_UNAVAILABLE"; }
  try {
    const kill = obj(await readJson(options.killSwitchPath || process.env.DISDEX_SHARED_KILL_SWITCH_PATH || "/var/lib/disdex/shared/kill-switch.json"));
    runtimeObservation.killSwitchActive = typeof kill?.active === "boolean" ? kill.active : undefined;
    runtimeObservation.killSwitchAction = typeof kill?.action === "string" ? kill.action : undefined;
    runtimeObservation.killSwitchReason = typeof kill?.reason === "string" ? kill.reason : undefined;
  } catch { /* Missing shared protection remains unknown; never implies permission. */ }

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

  const capturedTs = typeof state?.capturedAt === "string" ? Date.parse(state.capturedAt) : NaN;
  const shadowFresh = Number.isFinite(capturedTs) && now - capturedTs >= -60000 && now - capturedTs <= MAX_AGE_MS;
  if (state && !shadowFresh) errors.push("V12 V4 shadow state is stale or has an invalid/future timestamp.");
  const stateAvailable = Boolean(state && state.orderEnabled === false && state.tradingMutation === 0 && state.shadow === true && state.architecture === "MULTILOGIC_V4" && shadowFresh);
  if (state && !stateAvailable) errors.push("V12 V4 shadow state rejected; no rows, counts or caps are current observations.");
  if (!stateAvailable) state = null;

  let catalog: Json | null = null;
  try {
    catalog = obj(await readJson(catalogPath));
    if (!catalog) errors.push("V12 V4 route catalog is not an object.");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "V12 V4 route catalog unavailable.");
  }

  let midpointRankSource: Json[] = [];
  try {
    const priorityText = await readFile(midpointPriorityPath, "utf8");
    if (Buffer.byteLength(priorityText, "utf8") > MAX_BYTES || createHash("sha256").update(priorityText.replace(/\r\n/g, "\n")).digest("hex") !== PRIORITY_SHA256) throw new Error("MIDPOINT_PRIORITY_SHA256_MISMATCH");
    const raw = JSON.parse(priorityText) as unknown;
    if (!Array.isArray(raw) || raw.length !== 41) throw new Error("MIDPOINT_PRIORITY_41_ROUTES_REQUIRED");
    midpointRankSource = raw.map(obj).filter((x): x is Json => Boolean(x));
    const routeIds = new Set(midpointRankSource.map((x) => String(x.route || "")));
    if (routeIds.size !== 41) throw new Error("MIDPOINT_DUPLICATE_ROUTE");
  } catch (error) {
    midpointRankSource = [];
    errors.push(error instanceof Error ? error.message : "V12 midpoint rank file unavailable.");
  }
  const midpointRanks = new Map(midpointRankSource.map((x) => [String(x.route), x]));
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
      midpointTier: midpointRanks.get(String(r.route)) ? String(midpointRanks.get(String(r.route))?.tier || "") : undefined,
      midpointRank: midpointRanks.get(String(r.route))
        ? String(r.route) === "FAILED_BREAK_REV_SHORT_6H"
          ? 1 : num(midpointRanks.get(String(r.route))?.priority_order, 99) + 3
        : undefined,
      midpointGross: midpointRanks.get(String(r.route))
        ? String(r.route) === "FAILED_BREAK_REV_SHORT_6H"
          ? undefined // Core has native dynamically requested gross, not a fixed tier size.
          : String(midpointRanks.get(String(r.route))?.tier) === "D"
            ? 0.05 : Math.min(1, num(midpointRanks.get(String(r.route))?.gross) * 1.5)
        : undefined,
      midpointScore: midpointRanks.get(String(r.route)) ? num(midpointRanks.get(String(r.route))?.score) : undefined,
      midpointTrainCount: midpointRanks.get(String(r.route))
        ? num(midpointRanks.get(String(r.route))?.n30) : undefined,
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
    observedPolicyId: state?.policyId === MIDPOINT_ID ? MIDPOINT_ID : undefined,
    midpointPriorityAvailable: midpointRankSource.length === 41,
    midpointPromotionStatus: "BLOCKED_HINDSIGHT_LEAKAGE_AND_EXTERNAL_Y06",
    midpointBt: {
      "10bps": { finalEquityJpy: 291326103, dd: -0.20420014 },
      "20bps": { finalEquityJpy: 231193740, dd: -0.20965901 },
      "30bps": { finalEquityJpy: 174749524, dd: -0.18388765 },
    },
    midpointCaps: {
      recoveryFamilyGross: 2.50, v12Gross: 3.00, cryptoGross: 3.50, totalGross: 4.75,
    },
    stateAvailable,
    shadowFresh: stateAvailable && shadowFresh,
    certification: { status: "BLOCKED_PRODUCTION_PARITY", orderAuthority: false, certificateVerified: false, eightSystemParity: "NOT_PROVEN", blockers: ["Frozen full-year hindsight priority (training end 2026-08-10); not out-of-sample causal proof.", "External Y06: 102 entries, PF approximately 0.30; whole-portfolio external parity not certified.", "10bps maximum MTM DD 20.42% exceeds 20% goal.", "41-route venue execution, Exit lifecycle, quantities, reservations and eight-system live parity not certified."] },
    runtimeObservation,
    statePath,
    catalogAvailable: Boolean(catalog),
    catalogPath,
    routeCount: routeList.length,
    caps,
    counts: {
      rawRouteSymbolEvaluations: num(countsObj?.rawRouteSymbolEvaluations),
      independentlyQualifyingCandidates: candidates.length,
      admittedShadowVirtualLegs: accepted.length,
      rejectedShadowLegs: rejected.length,
      uniqueAdmittedSymbols: new Set(accepted.map(leg => leg.symbol)).size,
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
