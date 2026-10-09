/**
 * 2026-10-09 V12 V4 V2_M150_D05_CORE_NATIVE implementation candidate, SHADOW ONLY.
 * Full-development-year hindsight-ranked route priorities and 2-pass repaired entry/exit rules.
 * Never authorizes a venue order, irrespective of the request payload.
 *
 * Source: run_v12_v4_priority_gross_v2_sweep.py, case V2_M150_D05_CORE_NATIVE.
 * Real-money promotion blocked: full-year hindsight priority leakage, 10bps DD >20%, external Y06 failure.
 */
import priorityJson from "../docs/implementation/v12-v4-v2-full-year-priority.json";
import {
  admitV12V4ShadowCandidates,
  evaluateV12V4Routes,
  V12_V4_CAPS,
  V12_V4_ROUTE_CATALOG,
  type V12V4Features,
  type V12V4ShadowCandidate,
  type V12V4PortfolioContext,
} from "./v12-multilogic-v4-shadow";

export const V12_V4_V2_POLICY = "V2_M150_D05_CORE_NATIVE" as const;
export const V12_V4_V2_STATUS = "BLOCKED_HINDSIGHT_LEAKAGE_AND_EXTERNAL_Y06" as const;
export const V12_V4_V2_CAPS = Object.freeze({
  ...V12_V4_CAPS,
  recoveryFamilyGross: 2.5,
  v12Gross: 3.0,
  cryptoGross: 3.5,
  totalGross: 4.75,
});
export const V12_V4_V2_BT = Object.freeze({
  referenceCase: V12_V4_V2_POLICY,
  rankingSource: "Full-development-year realized trade results; lookahead leakage",
  costs: {
    "10bps": { finalEquityJpy: 291326102.6203428, dd: -0.2042001379546361 },
    "20bps": { finalEquityJpy: 231193740, dd: -0.2097 },
    "30bps": { finalEquityJpy: 174749524, dd: -0.1839 },
  },
  priceModelOnly: true,
  externalY06: { n: 102, winRate: 0.3725, profitFactor10bps: 0.2995 },
});

type RankedRow = {
  route: string;
  tier: "S" | "A" | "B" | "C" | "D";
  gross: number;
  priority_order: number;
  priority_rank: number | null;
  n30: number;
};
const RANKED: readonly RankedRow[] = priorityJson as RankedRow[];
export const V12_V4_V2_PRIORITY = Object.freeze(RANKED.map((r) => ({ ...r })));
const rankByRoute = new Map(RANKED.map((r) => [r.route, r]));

function verifyFrozenPolicy() {
  const catalog = new Set(V12_V4_ROUTE_CATALOG.map((r) => r.route));
  const ranks = new Set(RANKED.map((r) => r.priority_order));
  if (RANKED.length !== 41 || catalog.size !== 41 || ranks.size !== 41 || rankByRoute.size !== 41) {
    throw new Error("V12_V4_V2_PRIORITY_COUNT_MISMATCH");
  }
  for (const record of RANKED) {
    if (!catalog.has(record.route) || (record.route !== "FAILED_BREAK_REV_SHORT_6H" && record.priority_rank !== record.priority_order + 3) ||
        !Number.isFinite(record.gross) || !Number.isFinite(record.n30) ||
        record.n30 < 0 || record.gross <= 0 || record.gross > 1) {
      throw new Error("V12_V4_V2_PRIORITY_INVALID:" + record.route);
    }
  }
}
verifyFrozenPolicy();

export type V12V4V2Features = V12V4Features & {
  /**
   * Strictly causal H1 features recomputed for the candidate's eligible entry time.
   * This is NOT the source-signal feature vector used by first-pass filters.
   * Missing/mismatched values fail closed for routes requiring second-pass repairs.
   */
  v2EntryFeatures?: Partial<Pick<V12V4Features,
    "btc24" | "rel24" | "ema12Dist" | "rangeLoc24" | "compression" | "bodyAtr">> & {
      entryTsMs: number;
      lastClosedBarTsMs: number;
    };
};
type Token = "BTC24_ALIGNED" | "BTC6_OPPOSE" | "CLV_FAVOR" | "CLV_OPPOSE" |
  "VOL_GE1" | "BODY_FAVOR" | "AGE_12_24" | "EMA_10_20" | "RANGE_TOP25" |
  "REL24_NEG" | "EMA_GE1" | "RANGE_NOT_TOP" | "NOT_COMPRESS";
type RouteRepair = { tokens: readonly Token[]; hours?: number };

export const V12_V4_FIRST_PASS_REPAIRS: Readonly<Record<string, RouteRepair>> = Object.freeze({
  REC_G2_EARLY_BTC_OPPOSE_VOL: { tokens: ["BTC24_ALIGNED"], hours: 6 },
  REC_G3_LATE_BTC_REL: { tokens: ["CLV_FAVOR"] },
  REC_G4_MATURE_REL_RANGE: { tokens: ["BTC6_OPPOSE"], hours: 24 },
  REC_X06_TIME_12H: { tokens: ["VOL_GE1"], hours: 18 },
  REC_X07_TIME_6H: { tokens: ["BODY_FAVOR"] },
  REC_X08_TIME_48H: { tokens: ["CLV_OPPOSE"] },
  REC_X10_TIME_48H: { tokens: ["AGE_12_24"] },
  REC_X14_TIME_48H: { tokens: ["EMA_10_20", "RANGE_TOP25"] },
});
export const V12_V4_SECOND_PASS_REPAIRS: Readonly<Record<string, RouteRepair>> = Object.freeze({
  FAILED_BREAK_REV_SHORT_6H: { tokens: ["REL24_NEG", "BODY_FAVOR"], hours: 9 },
  CONT_SHORT_MID_AGE24_48: { tokens: ["EMA_GE1"], hours: 3 },
  REC_G1_MID_REL_LOWVOL: { tokens: ["RANGE_NOT_TOP"], hours: 12 },
  REC_X03_TIME_12H: { tokens: ["EMA_GE1"] },
  REC_X07_TIME_6H: { tokens: ["BTC24_ALIGNED", "NOT_COMPRESS"] },
  "REC_X13_TP1.5_SL1_H24": { tokens: ["NOT_COMPRESS"] },
});

function passes(token: Token, f: Partial<V12V4Features>): boolean {
  const n = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  switch (token) {
    case "BTC24_ALIGNED": return n(f.btc24) && f.btc24 >= 0;
    case "BTC6_OPPOSE": return n(f.btc6) && f.btc6 < 0;
    case "CLV_FAVOR": return n(f.clv) && f.clv >= 0.6;
    case "CLV_OPPOSE": return n(f.clv) && f.clv <= 0.4;
    case "VOL_GE1": return n(f.volRatio) && f.volRatio >= 1;
    case "BODY_FAVOR": return n(f.bodyAtr) && f.bodyAtr > 0;
    case "AGE_12_24": return n(f.age) && f.age >= 12 && f.age < 24;
    case "EMA_10_20": return n(f.ema12Dist) && f.ema12Dist >= 1 && f.ema12Dist < 2;
    case "RANGE_TOP25": return n(f.rangeLoc24) && f.rangeLoc24 >= 0.75;
    case "REL24_NEG": return n(f.rel24) && f.rel24 <= 0;
    case "EMA_GE1": return n(f.ema12Dist) && f.ema12Dist >= 1;
    case "RANGE_NOT_TOP": return n(f.rangeLoc24) && f.rangeLoc24 < 0.75;
    case "NOT_COMPRESS": return n(f.compression) && f.compression > 0.8;
  }
}

export type V2FilteredRow = {
  route: string; symbol: string; effectiveSide: string; eligibleEntryTs: number;
  reason: "FIRST_PASS_REPAIR_FILTER" | "SECOND_PASS_ENTRY_FEATURES_MISSING" | "SECOND_PASS_REPAIR_FILTER";
};

export function evaluateV12V4V2Routes(features: readonly V12V4V2Features[]) {
  const candidates: V12V4ShadowCandidate[] = [];
  const filtered: V2FilteredRow[] = [];
  for (const obs of features) {
    for (const candidate of evaluateV12V4Routes(obs)) {
      const rejected = (reason: V2FilteredRow["reason"]) =>
        filtered.push({ route: candidate.route, symbol: candidate.symbol,
          effectiveSide: candidate.effectiveSide, eligibleEntryTs: candidate.eligibleEntryTs, reason });
      const first = V12_V4_FIRST_PASS_REPAIRS[candidate.route];
      if (first && !first.tokens.every((t) => passes(t, obs))) {
        rejected("FIRST_PASS_REPAIR_FILTER");
        continue;
      }
      const second = V12_V4_SECOND_PASS_REPAIRS[candidate.route];
      const atEntry = obs.v2EntryFeatures;
      if (second) {
        if (!atEntry || atEntry.entryTsMs !== candidate.eligibleEntryTs ||
            !Number.isFinite(atEntry.lastClosedBarTsMs) ||
            atEntry.lastClosedBarTsMs >= atEntry.entryTsMs ||
            atEntry.lastClosedBarTsMs < atEntry.entryTsMs - 60 * 60 * 1000) {
          rejected("SECOND_PASS_ENTRY_FEATURES_MISSING");
          continue;
        }
        if (!second.tokens.every((t) => passes(t, atEntry))) {
          rejected("SECOND_PASS_REPAIR_FILTER");
          continue;
        }
      }
      const tr = rankByRoute.get(candidate.route);
      if (!tr) throw new Error("V12_V4_V2_UNKNOWN_ROUTE:" + candidate.route);
      // The BT gives native core priority 1 and native gross; every other route
      // receives full-year in-sample priority +3 and tier gross *1.5 (capped at 1.0).
      // D tier stays fixed 0.05x rather than scaling to 0.075x.
      const isCore = candidate.route === "FAILED_BREAK_REV_SHORT_6H";
      const gross = isCore ? candidate.requestedGross :
        tr.tier === "D" ? 0.05 : Math.min(1, tr.gross * 1.5);
      const hours = second?.hours ?? first?.hours;
      candidates.push({
        ...candidate,
        rank: isCore ? 1 : tr.priority_order + 3,
        requestedGross: gross,
        plannedExitPolicy: hours
          ? "BT_REPAIR_FIXED_" + hours + "H_NEXT_OPEN"
          : candidate.plannedExitPolicy,
      });
    }
  }
  candidates.sort((a, b) =>
    a.eligibleEntryTs - b.eligibleEntryTs ||
    a.rank - b.rank ||
    a.route.localeCompare(b.route) ||
    a.symbol.localeCompare(b.symbol));
  return { candidates, filtered };
}

export function buildV12V4V2ShadowSnapshot(args: {
  capturedAt?: string;
  observations: V12V4V2Features[];
  context?: V12V4PortfolioContext;
}) {
  const { candidates, filtered } = evaluateV12V4V2Routes(args.observations);
  const admission = admitV12V4ShadowCandidates(candidates, args.context, V12_V4_V2_CAPS);
  return {
    ok: true as const,
    readOnly: true as const,
    tradingMutation: 0 as const,
    shadow: true as const,
    orderEnabled: false as const,
    architecture: "MULTILOGIC_V4" as const,
    policyId: V12_V4_V2_POLICY,
    promotionStatus: V12_V4_V2_STATUS,
    capturedAt: args.capturedAt || new Date().toISOString(),
    caps: V12_V4_V2_CAPS,
    counts: {
      rawRouteSymbolEvaluations: args.observations.length * 41,
      independentlyQualifyingCandidates: candidates.length,
      admittedShadowVirtualLegs: admission.accepted.length,
      rejectedShadowLegs: admission.rejected.length,
      filteredByRepair: filtered.length,
      uniqueAdmittedSymbols: new Set(admission.accepted.map((x) => x.symbol)).size,
      realOrderEnabledV4: 0 as const,
    },
    candidates,
    accepted: admission.accepted,
    rejected: admission.rejected,
    filtered,
    activeLegs: admission.activeLegs,
  };
}
