import catalogJson from "../docs/research/V12_MULTILOGIC_V4_ROUTE_CATALOG_20261009.json";

export type V12V4Side = "LONG" | "SHORT";
export type V12V4Decision = "CANDIDATE" | "ACCEPTED_SHADOW" | "REJECTED_SHADOW";

export type V12V4Features = {
  symbol: string;
  sourceSide: V12V4Side;
  sourceSignalTs: number;
  age?: number;
  sret6?: number;
  ema12Dist?: number;
  btc6?: number;
  btc24?: number;
  rel12?: number;
  rel24?: number;
  break24Atr?: number;
  volRatio?: number;
  er24?: number;
  rangeLoc24?: number;
  pullback12Atr?: number;
  compression?: number;
  bodyAtr?: number;
  clv?: number;
  freshUpward90hOnset?: boolean;
  structuralUpBreak?: boolean;
  failedBelowWithin6h?: boolean;
  oppositeClvBodyConfirm?: boolean;
  coreRequestedGross?: number;
};

export type V12V4CatalogRoute = {
  route: string;
  family: string;
  entry_rule_tokens: string;
  entry_rule_text: string;
  source_side: string;
  side_transform: string;
  entry_delay_h: number;
  exit_policy: string;
  requested_gross_policy: string;
  rank_policy: string;
  minlift: string;
  opposite_preemption: string;
  route_slots: string;
  [key: string]: unknown;
};

export type V12V4ShadowCandidate = {
  strategyId: "V12";
  architecture: "MULTILOGIC_V4";
  shadow: true;
  orderEnabled: false;
  route: string;
  family: string;
  symbol: string;
  sourceSide: V12V4Side;
  effectiveSide: V12V4Side;
  sourceSignalTs: number;
  eligibleEntryTs: number;
  entryDelayHours: number;
  rank: number;
  requestedGross: number;
  entryRuleTokens: string[];
  features: V12V4Features;
  plannedExitPolicy: string;
  decision: "CANDIDATE";
  reason: "ROUTE_ELIGIBLE";
};

export type V12V4VirtualLeg = Omit<V12V4ShadowCandidate, "decision" | "reason"> & {
  virtualLegId: string;
  postMinLiftGross: number;
  decision: "ACCEPTED_SHADOW";
  reason: string;
  preemptedVirtualLegIds: string[];
};

export type V12V4RejectedLeg = Omit<V12V4ShadowCandidate, "decision" | "reason"> & {
  postMinLiftGross: number;
  decision: "REJECTED_SHADOW";
  reason: string;
  preemptedVirtualLegIds: string[];
};

export type V12V4PortfolioContext = {
  activeLegs?: V12V4VirtualLeg[];
  recoveryFamilyGrossBefore?: number;
  v12GrossBefore?: number;
  cryptoGrossBefore?: number;
  totalGrossBefore?: number;
  venueMinimumGrossBySymbol?: Record<string, number | undefined>;
};

export const V12_V4_CAPS = Object.freeze({
  recoveryRouteSlots: 16,
  recoveryFamilyGross: 1.0,
  normalRecoveryGross: 0.10,
  robustMaxGross: 0.25,
  minLiftMaxGross: 0.30,
  v12Gross: 2.0,
  cryptoGross: 3.0,
  totalGross: 4.25,
});

const catalog = catalogJson as unknown as {
  architecture: typeof V12_V4_CAPS & Record<string, unknown>;
  routes: V12V4CatalogRoute[];
};

export const V12_V4_ROUTE_CATALOG = Object.freeze(catalog.routes.slice());

function finite(v: number | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function tokenPass(token: string, f: V12V4Features): boolean {
  switch (token) {
    case "SIDE_SHORT": return f.sourceSide === "SHORT";
    case "SIDE_LONG": return f.sourceSide === "LONG";
    case "AGE_0_12": return finite(f.age) && f.age >= 0 && f.age < 12;
    case "AGE_0_24": return finite(f.age) && f.age >= 0 && f.age < 24;
    case "AGE_12_24": return finite(f.age) && f.age >= 12 && f.age < 24;
    case "AGE_24_48": return finite(f.age) && f.age >= 24 && f.age < 48;
    case "AGE_48_72": return finite(f.age) && f.age >= 48 && f.age < 72;
    case "AGE_72_97": return finite(f.age) && f.age >= 72 && f.age < 97;
    case "RET6_NEG": return finite(f.sret6) && f.sret6 < 0;
    case "RET6_0_05": return finite(f.sret6) && f.sret6 >= 0 && f.sret6 < 0.005;
    case "RET6_05_15": return finite(f.sret6) && f.sret6 >= 0.005 && f.sret6 < 0.015;
    case "RET6_15_30": return finite(f.sret6) && f.sret6 >= 0.015 && f.sret6 < 0.03;
    case "RET6_GE30": return finite(f.sret6) && f.sret6 >= 0.03;
    case "EMA_LT0": return finite(f.ema12Dist) && f.ema12Dist < 0;
    case "EMA_0_05": return finite(f.ema12Dist) && f.ema12Dist >= 0 && f.ema12Dist < 0.5;
    case "EMA_05_10": return finite(f.ema12Dist) && f.ema12Dist >= 0.5 && f.ema12Dist < 1;
    case "EMA_10_20": return finite(f.ema12Dist) && f.ema12Dist >= 1 && f.ema12Dist < 2;
    case "EMA_GE20": return finite(f.ema12Dist) && f.ema12Dist >= 2;
    case "EMA_GE_1ATR": return finite(f.ema12Dist) && f.ema12Dist >= 1;
    case "BTC6_ALIGNED": return finite(f.btc6) && f.btc6 >= 0;
    case "BTC6_OPPOSE": return finite(f.btc6) && f.btc6 < 0;
    case "BTC24_ALIGNED": return finite(f.btc24) && f.btc24 >= 0;
    case "BTC24_OPPOSE": return finite(f.btc24) && f.btc24 < 0;
    case "REL12_POS": return finite(f.rel12) && f.rel12 > 0;
    case "REL12_NEG": return finite(f.rel12) && f.rel12 <= 0;
    case "REL24_POS": return finite(f.rel24) && f.rel24 > 0;
    case "REL24_NEG": return finite(f.rel24) && f.rel24 <= 0;
    case "BREAK24": return finite(f.break24Atr) && f.break24Atr >= 0;
    case "NO_BREAK24": return finite(f.break24Atr) && f.break24Atr < 0;
    case "VOL_GE1": return finite(f.volRatio) && f.volRatio >= 1;
    case "VOL_LT1": return finite(f.volRatio) && f.volRatio < 1;
    case "ER24_GE30": return finite(f.er24) && f.er24 >= 0.3;
    case "ER24_LT30": return finite(f.er24) && f.er24 < 0.3;
    case "RANGE_TOP25": return finite(f.rangeLoc24) && f.rangeLoc24 >= 0.75;
    case "RANGE_MID": return finite(f.rangeLoc24) && f.rangeLoc24 >= 0.25 && f.rangeLoc24 < 0.75;
    case "RANGE_BOTTOM25": return finite(f.rangeLoc24) && f.rangeLoc24 < 0.25;
    case "RANGE_NOT_TOP25": return finite(f.rangeLoc24) && f.rangeLoc24 < 0.75;
    case "PULLBACK_LT025": return finite(f.pullback12Atr) && f.pullback12Atr < 0.25;
    case "PULLBACK_025_15": return finite(f.pullback12Atr) && f.pullback12Atr >= 0.25 && f.pullback12Atr <= 1.5;
    case "PULLBACK_GT15": return finite(f.pullback12Atr) && f.pullback12Atr > 1.5;
    case "COMPRESS": return finite(f.compression) && f.compression <= 0.8;
    case "EXPAND": return finite(f.compression) && f.compression >= 1.1;
    case "BODY_FAVOR": return finite(f.bodyAtr) && f.bodyAtr > 0;
    case "BODY_OPPOSE": return finite(f.bodyAtr) && f.bodyAtr <= 0;
    case "CLV_FAVOR": return finite(f.clv) && f.clv >= 0.6;
    case "CLV_OPPOSE": return finite(f.clv) && f.clv <= 0.4;
    case "FRESH_UPWARD_90H_ONSET": return f.freshUpward90hOnset === true;
    case "STRUCTURAL_UP_BREAK": return f.structuralUpBreak === true;
    case "FAIL_BACK_BELOW_LEVEL_WITHIN_6H": return f.failedBelowWithin6h === true;
    case "OPPOSITE_CLV_BODY_CONFIRM": return f.oppositeClvBodyConfirm === true;
    default:
      throw new Error(`V12_V4_UNKNOWN_RULE_TOKEN:${token}`);
  }
}

function routeRank(route: V12V4CatalogRoute): number {
  if (route.route === "FAILED_BREAK_REV_SHORT_6H") return 1;
  if (route.route === "CONT_SHORT_MID_AGE24_48") return 8;
  return 9;
}

function routeGross(route: V12V4CatalogRoute, f: V12V4Features): number {
  if (route.route === "FAILED_BREAK_REV_SHORT_6H") {
    const g = finite(f.coreRequestedGross) ? f.coreRequestedGross : 1;
    return Math.max(0, Math.min(1, g));
  }
  if (route.route === "CONT_SHORT_MID_AGE24_48") return V12_V4_CAPS.robustMaxGross;
  return V12_V4_CAPS.normalRecoveryGross;
}

function effectiveSide(route: V12V4CatalogRoute, sourceSide: V12V4Side): V12V4Side {
  if (route.side_transform === "FORCE_SHORT") return "SHORT";
  if (route.side_transform === "FLIP_SOURCE_SIDE") return sourceSide === "LONG" ? "SHORT" : "LONG";
  return sourceSide;
}

export function evaluateV12V4Routes(features: V12V4Features): V12V4ShadowCandidate[] {
  const out: V12V4ShadowCandidate[] = [];
  for (const route of V12_V4_ROUTE_CATALOG) {
    const tokens = String(route.entry_rule_tokens || "").split("|").map((x) => x.trim()).filter(Boolean);
    if (!tokens.every((token) => tokenPass(token, features))) continue;
    const entryDelayHours = Number(route.entry_delay_h || 0);
    out.push({
      strategyId: "V12",
      architecture: "MULTILOGIC_V4",
      shadow: true,
      orderEnabled: false,
      route: route.route,
      family: route.family,
      symbol: features.symbol.toUpperCase(),
      sourceSide: features.sourceSide,
      effectiveSide: effectiveSide(route, features.sourceSide),
      sourceSignalTs: features.sourceSignalTs,
      eligibleEntryTs: features.sourceSignalTs + entryDelayHours * 60 * 60 * 1000,
      entryDelayHours,
      rank: routeRank(route),
      requestedGross: routeGross(route, features),
      entryRuleTokens: tokens,
      features: { ...features, symbol: features.symbol.toUpperCase() },
      plannedExitPolicy: route.exit_policy,
      decision: "CANDIDATE",
      reason: "ROUTE_ELIGIBLE",
    });
  }
  return out.sort((a, b) => a.rank - b.rank || a.route.localeCompare(b.route));
}

function isRecoveryFamily(family: string): boolean {
  return family.startsWith("RECOVERY_");
}

function isPreemptibleRecovery(family: string): boolean {
  return family === "RECOVERY_X" || family === "RECOVERY_G";
}

function makeLegId(candidate: V12V4ShadowCandidate, serial: number): string {
  return [candidate.symbol, candidate.effectiveSide, candidate.route, candidate.eligibleEntryTs, serial].join(":");
}

export function admitV12V4ShadowCandidates(
  candidates: V12V4ShadowCandidate[],
  context: V12V4PortfolioContext = {},
  caps: Readonly<Record<keyof typeof V12_V4_CAPS, number>> = V12_V4_CAPS,
): { accepted: V12V4VirtualLeg[]; rejected: V12V4RejectedLeg[]; activeLegs: V12V4VirtualLeg[] } {
  let active = [...(context.activeLegs || [])];
  const accepted: V12V4VirtualLeg[] = [];
  const rejected: V12V4RejectedLeg[] = [];
  let serial = active.length;

  const reject = (candidate: V12V4ShadowCandidate, gross: number, reason: string, preempted: string[] = []) => {
    rejected.push({ ...candidate, postMinLiftGross: gross, decision: "REJECTED_SHADOW", reason, preemptedVirtualLegIds: preempted });
  };

  for (const candidate of candidates) {
    let gross = candidate.requestedGross;
    const venueMinGross = context.venueMinimumGrossBySymbol?.[candidate.symbol];
    if (finite(venueMinGross) && venueMinGross > gross) {
      if (venueMinGross > caps.minLiftMaxGross + 1e-12) {
        reject(candidate, gross, "VENUE_MIN_LIFT_EXCEEDS_0.30X");
        continue;
      }
      gross = venueMinGross;
    }

    const routeActive = active.filter((leg) => leg.route === candidate.route);
    if (isRecoveryFamily(candidate.family) && routeActive.length >= caps.recoveryRouteSlots) {
      reject(candidate, gross, "RECOVERY_ROUTE_SLOT_OCCUPIED");
      continue;
    }

    const opposite = active.filter((leg) => leg.symbol === candidate.symbol && leg.effectiveSide !== candidate.effectiveSide);
    let preempted: string[] = [];
    if (opposite.length) {
      const mayPreempt = candidate.family === "RECOVERY_Y_REVERSAL" && opposite.every((leg) => isPreemptibleRecovery(leg.family));
      if (!mayPreempt) {
        reject(candidate, gross, "OPPOSITE_SYMBOL_ACTIVE");
        continue;
      }
      preempted = opposite.map((leg) => leg.virtualLegId);
      active = active.filter((leg) => !preempted.includes(leg.virtualLegId));
    }

    const recoveryGross = (context.recoveryFamilyGrossBefore || 0) + active.filter((x) => isRecoveryFamily(x.family)).reduce((s, x) => s + x.postMinLiftGross, 0);
    if (isRecoveryFamily(candidate.family) && recoveryGross + gross > caps.recoveryFamilyGross + 1e-12) {
      reject(candidate, gross, "RECOVERY_FAMILY_GROSS_CAP", preempted);
      continue;
    }

    const v12Gross = (context.v12GrossBefore || 0) + active.reduce((s, x) => s + x.postMinLiftGross, 0);
    if (v12Gross + gross > caps.v12Gross + 1e-12) {
      reject(candidate, gross, "V12_GROSS_CAP", preempted);
      continue;
    }
    const cryptoGross = (context.cryptoGrossBefore || 0) + active.reduce((s, x) => s + x.postMinLiftGross, 0);
    if (cryptoGross + gross > caps.cryptoGross + 1e-12) {
      reject(candidate, gross, "CRYPTO_GROSS_CAP", preempted);
      continue;
    }
    const totalGross = (context.totalGrossBefore || 0) + active.reduce((s, x) => s + x.postMinLiftGross, 0);
    if (totalGross + gross > caps.totalGross + 1e-12) {
      reject(candidate, gross, "TOTAL_GROSS_CAP", preempted);
      continue;
    }

    serial += 1;
    const leg: V12V4VirtualLeg = {
      ...candidate,
      virtualLegId: makeLegId(candidate, serial),
      postMinLiftGross: gross,
      decision: "ACCEPTED_SHADOW",
      reason: preempted.length ? "ACCEPTED_AFTER_REC_Y_PREEMPT" : gross > candidate.requestedGross ? "ACCEPTED_WITH_MIN_LIFT" : "ACCEPTED_SHADOW",
      preemptedVirtualLegIds: preempted,
    };
    accepted.push(leg);
    active.push(leg);
  }
  return { accepted, rejected, activeLegs: active };
}

export function buildV12V4ShadowSnapshot(args: {
  capturedAt?: string;
  observations: V12V4Features[];
  context?: V12V4PortfolioContext;
}) {
  const routeCandidates = args.observations.flatMap(evaluateV12V4Routes);
  const admission = admitV12V4ShadowCandidates(routeCandidates, args.context);
  return {
    ok: true,
    readOnly: true,
    tradingMutation: 0 as const,
    architecture: "MULTILOGIC_V4" as const,
    shadow: true as const,
    orderEnabled: false as const,
    capturedAt: args.capturedAt || new Date().toISOString(),
    caps: V12_V4_CAPS,
    counts: {
      rawRouteSymbolEvaluations: args.observations.length * V12_V4_ROUTE_CATALOG.length,
      independentlyQualifyingCandidates: routeCandidates.length,
      admittedShadowVirtualLegs: admission.accepted.length,
      rejectedShadowLegs: admission.rejected.length,
      uniqueAdmittedSymbols: new Set(admission.accepted.map((x) => x.symbol)).size,
      realOrderEnabledV4: 0,
    },
    candidates: routeCandidates,
    accepted: admission.accepted,
    rejected: admission.rejected,
    activeLegs: admission.activeLegs,
  };
}
