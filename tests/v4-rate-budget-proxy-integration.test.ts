import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deferAsterGlobalRateBudget, waitForAsterGlobalRateSlot } from "../lib/disdex-aster-global-rate-budget";

const sha="a".repeat(40);
const budget="/var/lib/disdex/shared/aster-rate-budget.json";

test("an invalid or unavailable broker never falls back to direct shared writes", async () => {
  const names=["DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH","DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET","DISDEX_RELEASE_SHA"] as const;
  const original=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  try {
    const temporary=await mkdtemp(join(tmpdir(),"disdex-budget-proxy-"));
    process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=join(temporary,"budget.json");
    process.env.DISDEX_RELEASE_SHA=sha;
    process.env.DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET="/tmp/untrusted.sock";
    await assert.rejects(()=>waitForAsterGlobalRateSlot(1,"RISK_READ"),/PROXY_BUDGET_PATH_INVALID/);
    process.env.DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=budget;
    await assert.rejects(()=>waitForAsterGlobalRateSlot(1,"RISK_READ"),/SOCKET_PATH_INVALID/);
    await assert.rejects(()=>deferAsterGlobalRateBudget({path:budget,status:429,cooldownMs:60000}),/SOCKET_PATH_INVALID/);
    process.env.DISDEX_ASTER_RATE_BUDGET_PROXY_SOCKET=`/run/disdex-v4-budget-${sha}/budget.sock`;
    await assert.rejects(()=>waitForAsterGlobalRateSlot(1,"RISK_READ"),/PROXY_UNAVAILABLE|PROXY_TIMEOUT/);
  } finally {
    for(const name of names) {
      if(original[name]===undefined) delete process.env[name]; else process.env[name]=original[name];
    }
  }
});
