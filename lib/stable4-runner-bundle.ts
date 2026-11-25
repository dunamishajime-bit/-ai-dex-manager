import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/deploy-approval-token";

/**
 * One Owner approval for the six non-HYPE STABLE4 Runner permits.
 *
 * HYPE is intentionally absent: it has the separate H48_TIME_ONLY policy and
 * certificate/permit path.  The bundle source SHA is the reviewed STABLE4
 * production anchor; the per-Runner release SHAs below remain immutable and
 * are checked again by the Root transaction before any permit is installed.
 */
export const STABLE4_RUNNER_BUNDLE_OPERATION =
  "STABLE4_RUNNERS_SCOPED_ORDER_ENABLE_BUNDLE" as const;
export const STABLE4_RUNNER_BUNDLE_SCOPE = "STABLE4_SCOPED_RUNNERS" as const;
export const STABLE4_RUNNER_BUNDLE_SOURCE_SHA =
  "4786f600ae7bf86ffca948f1412956a9113cb20d" as const;

export type Stable4RunnerBundleEntry = {
  runner: "FET_BRK48_RESIDUAL" | "IDLE_PRIORITY_SHORT" | "PENGU_V8" |
    "QUALITY102_CAUSAL_V1" | "V12_V4" | "V52";
  sourceSha: string;
  planSha256: string;
  scope: string;
  operation: string;
  unitTemplate: string;
};

export const STABLE4_RUNNER_BUNDLE_ENTRIES: readonly Stable4RunnerBundleEntry[] = Object.freeze([
  {
    runner: "FET_BRK48_RESIDUAL",
    sourceSha: STABLE4_RUNNER_BUNDLE_SOURCE_SHA,
    planSha256: "568cf8f66490de5639ce2c5a8b14db385be922f1dde8d9079d3ca30022057712",
    scope: "FET_BRK48_RESIDUAL",
    operation: "FET_BRK48_RESIDUAL_SCOPED_ORDER_ENABLE",
    unitTemplate: "disdex-fet-brk48@{sha}.service",
  },
  {
    runner: "IDLE_PRIORITY_SHORT",
    sourceSha: STABLE4_RUNNER_BUNDLE_SOURCE_SHA,
    planSha256: "568cf8f66490de5639ce2c5a8b14db385be922f1dde8d9079d3ca30022057712",
    scope: "IDLE_PRIORITY_SHORT",
    operation: "IDLE_PRIORITY_SHORT_SCOPED_ORDER_ENABLE",
    unitTemplate: "disdex-idle-priority-short@{sha}.service",
  },
  {
    runner: "PENGU_V8",
    sourceSha: STABLE4_RUNNER_BUNDLE_SOURCE_SHA,
    planSha256: "568cf8f66490de5639ce2c5a8b14db385be922f1dde8d9079d3ca30022057712",
    scope: "PENGU_V8",
    operation: "PENGU_V8_SCOPED_ORDER_ENABLE",
    unitTemplate: "disdex-pengu-dual-ls-v2@{sha}.service",
  },
  {
    runner: "QUALITY102_CAUSAL_V1",
    sourceSha: STABLE4_RUNNER_BUNDLE_SOURCE_SHA,
    planSha256: "568cf8f66490de5639ce2c5a8b14db385be922f1dde8d9079d3ca30022057712",
    scope: "QUALITY102_CAUSAL_V1",
    operation: "QUALITY102_CAUSAL_V1_SCOPED_ORDER_ENABLE",
    unitTemplate: "disdex-quality102-causal-v1@{sha}.service",
  },
  {
    runner: "V12_V4",
    sourceSha: STABLE4_RUNNER_BUNDLE_SOURCE_SHA,
    planSha256: "568cf8f66490de5639ce2c5a8b14db385be922f1dde8d9079d3ca30022057712",
    scope: "V12_V4",
    operation: "V12_V4_SCOPED_ORDER_ENABLE",
    unitTemplate: "disdex-v12-v4@{sha}.service",
  },
  {
    runner: "V52",
    sourceSha: STABLE4_RUNNER_BUNDLE_SOURCE_SHA,
    planSha256: "568cf8f66490de5639ce2c5a8b14db385be922f1dde8d9079d3ca30022057712",
    scope: "V52",
    operation: "V52_SCOPED_ORDER_ENABLE",
    unitTemplate: "disdex-v52-aster-only@{sha}.service",
  },
] as const);

type Stable4RunnerBundleManifestBody = {
  schema: "STABLE4_RUNNER_BUNDLE_MANIFEST_V1";
  sourceSha: typeof STABLE4_RUNNER_BUNDLE_SOURCE_SHA;
  operation: typeof STABLE4_RUNNER_BUNDLE_OPERATION;
  scope: typeof STABLE4_RUNNER_BUNDLE_SCOPE;
  ordersEnabled: true;
  runnerSet: readonly Stable4RunnerBundleEntry["runner"][];
  economics: {
    cryptoGrossCap: 3;
    stockGrossCap: 4;
    totalGrossCap: 4.25;
    v52V11GrossCap: 2;
    v52V50GrossCap: 2;
    v4AggregateGrossCap: 2;
    penguGrossCap: 1;
    hypeTrendGrossCap: 1.5;
    v4NewOrderDdStopPct: 30;
    penguDdProtectionPct: 17;
    sharedRiskDailyLossPct: 7.5;
  };
  safety: {
    funding: "preserve";
    globalHold: "must_remain_active";
    h48: "separate_exact_scope";
    residentStop: "preserve";
  };
  runners: readonly Stable4RunnerBundleEntry[];
};

export type Stable4RunnerBundleManifest = Stable4RunnerBundleManifestBody & {
  manifestSha256: string;
};

const BODY: Stable4RunnerBundleManifestBody = Object.freeze({
  schema: "STABLE4_RUNNER_BUNDLE_MANIFEST_V1",
  sourceSha: STABLE4_RUNNER_BUNDLE_SOURCE_SHA,
  operation: STABLE4_RUNNER_BUNDLE_OPERATION,
  scope: STABLE4_RUNNER_BUNDLE_SCOPE,
  ordersEnabled: true,
  runnerSet: STABLE4_RUNNER_BUNDLE_ENTRIES.map((entry) => entry.runner),
  economics: {
    cryptoGrossCap: 3,
    hypeTrendGrossCap: 1.5,
    penguDdProtectionPct: 17,
    penguGrossCap: 1,
    sharedRiskDailyLossPct: 7.5,
    stockGrossCap: 4,
    totalGrossCap: 4.25,
    v4AggregateGrossCap: 2,
    v4NewOrderDdStopPct: 30,
    v52V11GrossCap: 2,
    v52V50GrossCap: 2,
  } as const,
  safety: {
    funding: "preserve",
    globalHold: "must_remain_active",
    h48: "separate_exact_scope",
    residentStop: "preserve",
  } as const,
  runners: STABLE4_RUNNER_BUNDLE_ENTRIES,
});

export function stable4RunnerBundleManifest(): Stable4RunnerBundleManifest {
  return {
    ...BODY,
    manifestSha256: createHash("sha256").update(canonicalJson(BODY)).digest("hex"),
  };
}

export const STABLE4_RUNNER_BUNDLE_PLAN_SHA256 =
  stable4RunnerBundleManifest().manifestSha256;

