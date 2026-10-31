#!/usr/bin/env node
// Safety contract for the production homepage. Fail closed when the legacy
// hard-coded dashboard replaces the read-only V12 V4/Q102 observability UI.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p) => {
  const full = join(root, p);
  if (!existsSync(full)) throw new Error("HP_UI_REGRESSION_MISSING_FILE: " + p);
  return readFileSync(full, "utf8");
};
const requireText = (p, needles) => {
  const value = read(p);
  for (const needle of needles) {
    if (!value.includes(needle)) throw new Error(`HP_UI_REGRESSION_MISSING_FEATURE: ${p} -> ${needle}`);
  }
  return value;
};
const home = requireText("app/page.tsx", [
  "useLivePortfolio", "useProductionRuntime",
  "V12V4RuntimePanel", "V12RouteInventoryPanel",
]);
if (home.includes("V96 + PENGU_DUAL_LS_V2_FINAL + V52")) {
  throw new Error("HP_UI_REGRESSION_LEGACY_STATIC_HOME_REINTRODUCED");
}
requireText("components/layout/Sidebar.tsx", [
  'href: "/realtime"', 'href: "/decision-status"',
  'href: "/performance"', 'href: "/production-approval"',
]);
const requiredPaths = [
  "app/realtime/page.tsx",
  "app/decision-status/page.tsx",
  "app/performance/page.tsx",
  "app/history/page.tsx",
  "app/positions/page.tsx",
  "app/production-approval/page.tsx",
  "app/api/production-approval/route.ts",
  "app/api/system/deploy-approval/route.ts",
  "app/api/system/live-runtime/route.ts",
  "app/api/system/live-portfolio/route.ts",
  "app/api/system/decision-status/route.ts",
];
for (const p of requiredPaths) read(p);
const pkg = JSON.parse(read("package.json"));
if (!/^\^?16\./.test(pkg.dependencies?.next || "")) {
  throw new Error("HP_UI_REGRESSION_NEXT16_RUNTIME_REQUIRED");
}
const config = read("next.config.mjs");
if (!config.includes('output: "standalone"')) {
  throw new Error("HP_UI_REGRESSION_STANDALONE_REQUIRED");
}
console.log("HP_UI_REGRESSION_GUARD_PASS: V12 V4/Q102 observability, realtime, decision-status, performance, approval and Next16 standalone preserved.");
