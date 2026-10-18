import test from "node:test";
import assert from "node:assert/strict";
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
