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
  "e0e4f1d8f22b62e9410188ef6e590a20e31f760f" as const;

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
    sourceSha: "7688ed7c93a1918d8b44837339b7da5584a868f5",
    planSha256: "12272418221383c53382b98bcefdda7eaba20f2655e9489eebbbdd73713c4717",
    scope: "FET_BRK48_RESIDUAL",
    operation: "FET_BRK48_RESIDUAL_SCOPED_ORDER_ENABLE",
    unitTemplate: "disdex-fet-brk48@{sha}.service",
  },
  {
    runner: "IDLE_PRIORITY_SHORT",
    sourceSha: "7688ed7c93a1918d8b44837339b7da5584a868f5",
    planSha256: "ed6e7da737480349a6454868ed78bcbc4db5f3990a6f4cc2bbb6e111cc3346db",
    scope: "IDLE_PRIORITY_SHORT",
    operation: "IDLE_PRIORITY_SHORT_SCOPED_ORDER_ENABLE",
    unitTemplate: "disdex-idle-priority-short@{sha}.service",
  },
  {
    runner: "PENGU_V8",
    sourceSha: "1657e173d250ad58f53e62f7bb0a3428fb405496",
    planSha256: "8928520a2391d8190c2cdda8b6e3e36959a452ed151d36a820a2ce3f8ec01568",
    scope: "PENGU_V8",
    operation: "PENGU_V8_SCOPED_ORDER_ENABLE",
    unitTemplate: "disdex-pengu-dual-ls-v2@{sha}.service",
  },
  {
    runner: "QUALITY102_CAUSAL_V1",
    sourceSha: "ef1ab178e26a7bf5bddb6473467765edba242e1d",
    planSha256: "01110a52b9ab740652cca48354e246edf71759916df476797b8e9753221ae4b6",
    scope: "QUALITY102_CAUSAL_V1",
    operation: "QUALITY102_CAUSAL_V1_SCOPED_ORDER_ENABLE",
    unitTemplate: "disdex-quality102-causal-v1@{sha}.service",
  },
  {
    runner: "V12_V4",
    sourceSha: "e788abc82e80f9fc7ab0e1ba83fdb8be267eb513",
    planSha256: "9fc3cc72c9520a758f1b700ed648f0e1e11a54eb92c514b08992f22605d9e515",
    scope: "V12_V4",
    operation: "V12_V4_SCOPED_ORDER_ENABLE",
    unitTemplate: "disdex-v12-v4@{sha}.service",
  },
  {
    runner: "V52",
    sourceSha: "8495daf24e53a6cf0dd5e38f022008fa8f78c688",
    planSha256: "a43d6e47acdc862953801a89e396f8819eeb9a580cc2aaadc901d926c23d011c",
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
