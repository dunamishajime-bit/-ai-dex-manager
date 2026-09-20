import { readFile } from "node:fs/promises";

type Readiness = {
  schema: string;
  target: string;
  implementationStatus?: "BLOCKED" | "READY";
  status: "BLOCKED" | "READY";
  ordersEnabled: boolean;
  blockers: string[];
  completed: string[];
};

async function text(path: string) {
  return readFile(path, "utf8");
}

async function main() {
  const readiness = JSON.parse(await text("docs/production/current-implementation-readiness.json")) as Readiness;
  const canonical = JSON.parse(await text("docs/production/current-live-target.json"));
  const [v12, pengu, q102, v52, managed] = await Promise.all([
    text("lib/v12-strict-live-adapter.ts"),
    text("lib/pengu-dual-ls-v2-portfolio-runner.ts"),
    text("lib/disdex-quality102-causal-v1-runner.ts"),
    text("scripts/disdex_v52_aster_only_live_engine.py"),
    text("lib/disdex-managed-protective-orders.ts"),
  ]);

  const observed: Record<string, boolean> = {
    FET_CORE_PREEMPTION_V12_UNWIRED: !v12.includes("reduceFetBrk48ForCoreConflict") && !v12.includes("disdex-fet-brk48-core-preempt"),
    FET_CORE_PREEMPTION_PENGU_UNWIRED: !pengu.includes("reduceFetBrk48ForCoreConflict") && !pengu.includes("disdex-fet-brk48-core-preempt"),
    FET_CORE_PREEMPTION_Q102_UNWIRED: !q102.includes("reduceFetBrk48ForCoreConflict") && !q102.includes("disdex-fet-brk48-core-preempt"),
    FET_CORE_PREEMPTION_V52_UNWIRED: !v52.includes("disdex-fet-brk48-core-preempt") && !v52.includes("FET_BRK48_CORE_PREEMPT"),
    FET_PROTECTIVE_ORDER_V12_RECOGNITION_UNWIRED: !v12.includes("findManagedFetBrk48ProtectiveOrders"),
    FET_PROTECTIVE_ORDER_PENGU_RECOGNITION_UNWIRED: !pengu.includes("findManagedFetBrk48ProtectiveOrders"),
  };

  if (readiness.schema !== "disdex-current-implementation-readiness/v1") throw new Error("READINESS_SCHEMA_INVALID");
  if (readiness.target !== canonical.formalBacktest.selectedCase) throw new Error("READINESS_TARGET_MISMATCH");
  if (canonical.acceptance.requireFetCorePreemption !== true) throw new Error("CANONICAL_FET_PREEMPTION_NOT_REQUIRED");
  if (!managed.includes("findManagedFetBrk48ProtectiveOrders")) throw new Error("FET_PROTECTIVE_ORDER_CLASSIFIER_MISSING");

  const actualImplementationBlockers = Object.entries(observed).filter(([, blocked]) => blocked).map(([name]) => name).sort();
  const implementationBlockerNames = new Set(Object.keys(observed));
  const declaredImplementationBlockers = readiness.blockers.filter((name) => implementationBlockerNames.has(name)).sort();
  if (JSON.stringify(actualImplementationBlockers) !== JSON.stringify(declaredImplementationBlockers)) {
    throw new Error(`READINESS_BLOCKER_DRIFT:declared=${declaredImplementationBlockers.join(",")}:actual=${actualImplementationBlockers.join(",")}`);
  }
  const activationBlockers = readiness.blockers.filter((name) => !implementationBlockerNames.has(name)).sort();
  const allowedActivationBlockers = new Set(["OPERATOR_LIVE_ACTIVATION_REQUIRED"]);
  if (activationBlockers.some((name) => !allowedActivationBlockers.has(name))) {
    throw new Error(`READINESS_UNKNOWN_ACTIVATION_BLOCKER:${activationBlockers.join(",")}`);
  }
  if (actualImplementationBlockers.length === 0 && readiness.implementationStatus !== "READY") {
    throw new Error("READINESS_IMPLEMENTATION_STATUS_NOT_READY");
  }

  const blockers = [...actualImplementationBlockers, ...activationBlockers];
  const implementationReady = actualImplementationBlockers.length === 0 && readiness.implementationStatus === "READY";
  if (process.argv.includes("--require-implementation-ready") && !implementationReady) {
    console.log(JSON.stringify({ status: "PRODUCTION_IMPLEMENTATION_NOT_READY", target: readiness.target, implementationReady: false, blockers: actualImplementationBlockers, ordersSent: 0, cancelSent: 0, positionChangesSent: 0 }));
    process.exitCode = 2;
    return;
  }
  if (blockers.length > 0 || readiness.status !== "READY" || readiness.ordersEnabled !== true) {
    console.log(JSON.stringify({
      status: "PRODUCTION_ACTIVATION_BLOCKED",
      target: readiness.target,
      implementationReady,
      blockers,
      ordersSent: 0,
      cancelSent: 0,
      positionChangesSent: 0,
    }));
    if (process.argv.includes("--require-ready")) process.exitCode = 2;
    return;
  }

  console.log(JSON.stringify({
    status: "PRODUCTION_ACTIVATION_READY",
    target: readiness.target,
    blockers: [],
    ordersSent: 0,
    cancelSent: 0,
    positionChangesSent: 0,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "PRODUCTION_ACTIVATION_CHECK_FAILED",
    message: error instanceof Error ? error.message : String(error),
    ordersSent: 0,
    cancelSent: 0,
    positionChangesSent: 0,
  }));
  process.exitCode = 1;
});
