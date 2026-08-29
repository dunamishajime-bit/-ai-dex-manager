import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const decisionUi = fs.readFileSync(path.join(root, "components/features/DecisionUi.tsx"), "utf8");
const home = fs.readFileSync(path.join(root, "app/page.tsx"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "app/positions/page.tsx"), "utf8");

const strategyStart = decisionUi.indexOf("export function StrategyOverviewCards");
const strategyEnd = decisionUi.indexOf("export function AttentionList");
assert.ok(strategyStart >= 0 && strategyEnd > strategyStart, "StrategyOverviewCards source must exist");
const strategySource = decisionUi.slice(strategyStart, strategyEnd);

assert.match(home, /<StrategyOverviewCards cards=\{model\.strategyCards\} compact \/>/, "home must use the shared strategy cards");
assert.match(dashboard, /<StrategyOverviewCards cards=\{model\.strategyCards\} \/>/, "dashboard must use the shared strategy cards");

assert.match(strategySource, /min-w-0 max-w-full/, "strategy cards must be allowed to shrink inside a mobile grid");
assert.match(strategySource, /flex flex-wrap items-start justify-between gap-2/, "strategy header must wrap instead of widening the card");
assert.match(strategySource, /grid grid-cols-2 gap-1\.5 text-center min-\[400px\]:grid-cols-3/, "strategy metrics must use two columns on narrow phones and three from 400px");
assert.match(strategySource, /min-w-0 flex-1 break-words text-right/, "stage text must shrink and wrap inside the card");
assert.ok((strategySource.match(/break-words/g) || []).length >= 2, "stage and blocker text must both allow word breaking");
assert.ok((strategySource.match(/\[overflow-wrap:anywhere\]/g) || []).length >= 2, "stage and blocker text must both wrap long unbroken tokens");

console.log("DISTERMINAL_MOBILE_UI_SELFTEST_PASS");
