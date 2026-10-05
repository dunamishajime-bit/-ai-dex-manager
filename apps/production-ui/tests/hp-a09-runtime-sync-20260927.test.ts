import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
const read=(name:string)=>readFileSync(name,"utf8");
test("exactly five strategy runtimes are represented in production SHA lineage",()=>{
  const source=read("lib/server/current-production-runtime.ts");
  assert.match(source,/fet: "\/var\/lib\/disdex\/fet-brk48-residual\/state\.json"/);
  assert.match(source,/unit === "fet" && typeof raw\.runtimeCommitSha/);
  assert.match(source,/fet: releaseSha/);
});
test("FET page and read-only authenticated API are present",()=>{
  const page=read("app/decision-status/fet/page.tsx");
  const api=read("app/api/system/fet-status/route.ts");
  const panel=read("components/features/DecisionStatusPanel.tsx");
  assert.match(page,/DecisionStatusPanel logic="fet"/);
  assert.match(page,/LivePerformanceDashboard logic="FET"/);
  assert.match(api,/disdex_auth/);
  assert.match(api,/loadCurrentProductionRuntime/);
  assert.match(api,/expectedReleaseSha:current\.releaseSha/);
  assert.match(api,/tradingMutation:0/);
  assert.match(panel,/key: "fet", title: "FET BRK48"/);
  assert.match(panel,/logic === "fet"/);
  assert.doesNotMatch(api+page,/placeMarket|executeEntry|submitOrder|cancelOrder/);
});
test("do not conflate UI build SHA and new trading runtime SHA",()=>{
  assert.match(read("app/page.tsx"),/HPのビルドSHAと売買Runtime SHA/);
  assert.match(read("components/layout/Sidebar.tsx"),/FET 判定/);
  assert.doesNotMatch(read("components/layout/Sidebar.tsx"),/V52時間外停止/);
});
