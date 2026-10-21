import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";

test("V4 canary and production do not restart-loop after fatal fail-closed exit",()=>{
 for(const path of ["deploy/systemd/disdex-v12-v4-canary@.service","deploy/systemd/disdex-v12-v4@.service"]){
  const unit=readFileSync(path,"utf8");
  assert.match(unit,/^Restart=on-failure$/m);
  assert.match(unit,/^RestartPreventExitStatus=2$/m);
  assert.match(unit,/scripts\/v12-v4-production-runner\.ts --daemon/);
 }
 const legacy=readFileSync("deploy/systemd/disdex-v12-x1-all@.service","utf8");
 assert.match(legacy,/^RestartPreventExitStatus=2$/m);
});

test("watchdog holds a failed fail-closed runner instead of restarting it",()=>{
 const source=readFileSync("scripts/ops/root/disdex-runner-watchdog-current.mjs","utf8");
 assert.match(source,/ExecMainStatus/);
 assert.match(source,/V4_FATAL_FAIL_CLOSED/);
 const output=execFileSync(process.execPath,["scripts/ops/root/disdex-runner-watchdog-current.mjs","--self-test"],{encoding:"utf8"});
 assert.match(output,/DISDEX_CURRENT_WATCHDOG_FATAL_FAIL_CLOSED_SELFTEST_PASS/);
});
