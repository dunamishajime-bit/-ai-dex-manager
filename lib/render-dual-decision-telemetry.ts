/**
 * Truthful, read-only telemetry for the existing and independent RENDER SHORT
 * routes. A passing market decision is never treated as an order permission:
 * shared risk, owner, margin, venue, and operator gates remain authoritative.
 */
import {
  RENDER_ENTRY_POLICY,
  RENDER_INDEPENDENT_ROUTE,
  RENDER_LEGACY_INITIAL_STOP_POLICY,
} from "./render-highwr-and-legacy-stop";
import type { IdleSignal } from "./idle-priority-short-signal";
import type { RenderCertificateInspection } from "./render-route-certification";
import type { RenderShadowDecision } from "./render-independent-six-hour-journal";

export const RENDER_DUAL_DECISION_SCHEMA = "disdex-render-dual-decision-telemetry/v1" as const;

type LegacyPosition = {
  route?: string;
  protectionVerified?: boolean;
  legacyRenderAdverse?: {
    watchStartedAt?: number | null;
    lastClosedM5Ts?: number | null;
    maxFavorableExcursionPct?: number;
    completed?: boolean;
  };
};

export type RenderDualDecisionTelemetry = {
  schema: typeof RENDER_DUAL_DECISION_SCHEMA;
  runtimeSha: string;
  decisionTs: number;
  updatedAt: number;
  legacy: {
    route: "IDLE_RENDER_RELATIVE_SHORT";
    role: "EXISTING_POSITION_EXIT_OVERLAY";
    liveAuthorized: boolean;
    certificate: RenderCertificateInspection;
    status: "DISABLED" | "BLOCKED" | "READY_FOR_EXISTING_POSITION" | "WATCHING" | "EXIT_REQUESTED";
    orderPermission: "EXIT_ONLY" | "DENIED" | "NOT_APPLICABLE";
    policy: {
      gross: 0.25;
      stopPct: 10;
      takeProfitPct: 25;
      adverseTouchPct: -1;
      watchMinutes: 120;
      maxFavorableExcursionPct: 0.25;
    };
    position: {
      present: boolean;
      protectionVerified: boolean;
      watchStartedAt: number | null;
      lastClosedM5Ts: number | null;
      maxFavorableExcursionPct: number | null;
    };
    gate: { accepted: boolean; reason: string; holdHours: number } | null;
    reason: string;
  };
  independent: {
    route: typeof RENDER_INDEPENDENT_ROUTE;
    role: "INDEPENDENT_SHORT_ENTRY";
    liveAuthorized: boolean;
    certificate: RenderCertificateInspection;
    status: "BLOCKED" | "SHADOW" | "CANDIDATE";
    orderPermission: "DENIED" | "NOT_PROVEN";
    policy: {
      grossMax: 0.75;
      venueLeverage: 5;
      marginType: "CROSS";
      stopPct: 2;
      takeProfitPct: 2.5;
      maxHoldMinutes: 360;
      cooldownHours: 12;
      requiresOpenInterest: false;
      requiresShadowQuality: false;
    };
    sameSymbolPositionOrPending: boolean;
    decision: {
      rawAccepted: boolean;
      rawReason: string;
      priorityAccepted: boolean;
      priorityReason: string;
      pendingCount: number;
      settledCount: number;
      features?: RenderShadowDecision["features"];
    } | null;
    reason: string;
  };
};

function legacyPositionState(position: LegacyPosition | undefined) {
  const adverse = position?.legacyRenderAdverse;
  return {
    present: Boolean(position),
    protectionVerified: position?.protectionVerified === true,
    watchStartedAt: typeof adverse?.watchStartedAt === "number" ? adverse.watchStartedAt : null,
    lastClosedM5Ts: typeof adverse?.lastClosedM5Ts === "number" ? adverse.lastClosedM5Ts : null,
    maxFavorableExcursionPct: typeof adverse?.maxFavorableExcursionPct === "number" ? adverse.maxFavorableExcursionPct : null,
  };
}

export function buildRenderDualDecisionTelemetry(input: {
  runtimeSha: string;
  decisionTs: number;
  updatedAt: number;
  legacyAuthorized: boolean;
  legacyCertificate: RenderCertificateInspection;
  legacyPosition?: LegacyPosition;
  legacyGate?: Pick<IdleSignal, "accepted" | "reason" | "holdHours">;
  independentAuthorized: boolean;
  independentCertificate: RenderCertificateInspection;
  independentDecision?: RenderShadowDecision;
  sameSymbolPositionOrPending: boolean;
}): RenderDualDecisionTelemetry {
  const position = legacyPositionState(input.legacyPosition);
  const legacyPolicy = {
    gross: 0.25 as const,
    stopPct: 10 as const,
    takeProfitPct: 25 as const,
    adverseTouchPct: RENDER_LEGACY_INITIAL_STOP_POLICY.adverseTouchAtOrBelowPct,
    watchMinutes: RENDER_LEGACY_INITIAL_STOP_POLICY.watchMinutes,
    maxFavorableExcursionPct: RENDER_LEGACY_INITIAL_STOP_POLICY.maxFavorableExcursionMustBeStrictlyBelowPct,
  };
  let legacyStatus: RenderDualDecisionTelemetry["legacy"]["status"];
  let legacyPermission: RenderDualDecisionTelemetry["legacy"]["orderPermission"];
  let legacyReason: string;
  if (!input.legacyAuthorized) {
    legacyStatus = "DISABLED";
    legacyPermission = position.present ? "DENIED" : "NOT_APPLICABLE";
    legacyReason = "RENDER_LEGACY_ADVERSE_LIVE_FLAG_DISABLED";
  } else if (input.legacyCertificate.status !== "VALID") {
    legacyStatus = "BLOCKED";
    legacyPermission = "DENIED";
    legacyReason = input.legacyCertificate.reason;
  } else if (!position.present) {
    legacyStatus = "READY_FOR_EXISTING_POSITION";
    legacyPermission = "EXIT_ONLY";
    legacyReason = "RENDER_LEGACY_ADVERSE_WAITING_FOR_EXISTING_POSITION";
  } else if (!position.protectionVerified) {
    legacyStatus = "BLOCKED";
    legacyPermission = "DENIED";
    legacyReason = "RENDER_LEGACY_EXISTING_PROTECTION_UNVERIFIED";
  } else if (input.legacyPosition?.legacyRenderAdverse?.completed === true) {
    legacyStatus = "EXIT_REQUESTED";
    legacyPermission = "EXIT_ONLY";
    legacyReason = "RENDER_LEGACY_NEGATIVE1_WATCH2H_MFE_LT_025";
  } else {
    legacyStatus = "WATCHING";
    legacyPermission = "EXIT_ONLY";
    legacyReason = "RENDER_LEGACY_ADVERSE_WATCH_ACTIVE_OR_WAITING";
  }

  const shadow = input.independentDecision;
  let independentStatus: RenderDualDecisionTelemetry["independent"]["status"];
  let independentPermission: RenderDualDecisionTelemetry["independent"]["orderPermission"];
  let independentReason: string;
  if (!input.independentAuthorized) {
    independentStatus = "BLOCKED";
    independentPermission = "DENIED";
    independentReason = "RENDER_INDEPENDENT_LIVE_FLAG_DISABLED";
  } else if (input.independentCertificate.status !== "VALID") {
    independentStatus = "BLOCKED";
    independentPermission = "DENIED";
    independentReason = input.independentCertificate.reason;
  } else if (input.sameSymbolPositionOrPending) {
    independentStatus = "BLOCKED";
    independentPermission = "DENIED";
    independentReason = "RENDER_SAME_SYMBOL_POSITION_OR_PENDING";
  } else if (!shadow) {
    independentStatus = "BLOCKED";
    independentPermission = "DENIED";
    independentReason = "RENDER_INDEPENDENT_DECISION_UNAVAILABLE";
  } else if (!shadow.rawAccepted) {
    independentStatus = "SHADOW";
    independentPermission = "DENIED";
    independentReason = shadow.rawReason;
  } else if (!shadow.priority.accepted) {
    independentStatus = "CANDIDATE";
    independentPermission = "NOT_PROVEN";
    independentReason = shadow.priority.reason;
  } else {
    // Decision details alone cannot prove shared risk, margin, account-lock,
    // venue readback, and final order admission. Keep this explicitly
    // non-authorizing until the actual entry path records those checks.
    independentStatus = "CANDIDATE";
    independentPermission = "NOT_PROVEN";
    independentReason = "RENDER_INDEPENDENT_RUNTIME_ADMISSION_PENDING";
  }

  return {
    schema: RENDER_DUAL_DECISION_SCHEMA,
    runtimeSha: input.runtimeSha,
    decisionTs: input.decisionTs,
    updatedAt: input.updatedAt,
    legacy: {
      route: "IDLE_RENDER_RELATIVE_SHORT",
      role: "EXISTING_POSITION_EXIT_OVERLAY",
      liveAuthorized: input.legacyAuthorized,
      certificate: input.legacyCertificate,
      status: legacyStatus,
      orderPermission: legacyPermission,
      policy: legacyPolicy,
      position,
      gate: input.legacyGate ? { accepted: input.legacyGate.accepted, reason: input.legacyGate.reason, holdHours: input.legacyGate.holdHours } : null,
      reason: legacyReason,
    },
    independent: {
      route: RENDER_INDEPENDENT_ROUTE,
      role: "INDEPENDENT_SHORT_ENTRY",
      liveAuthorized: input.independentAuthorized,
      certificate: input.independentCertificate,
      status: independentStatus,
      orderPermission: independentPermission,
      policy: {
        grossMax: RENDER_ENTRY_POLICY.independentRequestedGross,
        venueLeverage: RENDER_ENTRY_POLICY.independentVenueLeverage,
        marginType: "CROSS",
        stopPct: RENDER_ENTRY_POLICY.independentRealStopLossPct,
        takeProfitPct: RENDER_ENTRY_POLICY.independentRealTakeProfitPct,
        maxHoldMinutes: RENDER_ENTRY_POLICY.independentRealMaxMinutes,
        cooldownHours: RENDER_ENTRY_POLICY.newIndependentCooldownHours,
        requiresOpenInterest: false,
        requiresShadowQuality: false,
      },
      sameSymbolPositionOrPending: input.sameSymbolPositionOrPending,
      decision: shadow ? {
        rawAccepted: shadow.rawAccepted,
        rawReason: shadow.rawReason,
        priorityAccepted: shadow.priority.accepted,
        priorityReason: shadow.priority.reason,
        pendingCount: shadow.pendingCount,
        settledCount: shadow.settledCount,
        features: shadow.features,
      } : null,
      reason: independentReason,
    },
  };
}
