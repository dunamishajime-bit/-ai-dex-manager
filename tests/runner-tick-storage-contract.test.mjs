import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const source = readFileSync(join(process.cwd(),"scripts/ops/root/disdex-current-runtime-wiring"),"utf8");

test("tick parent remains root-owned while child is deploy-writable",()=>{
 assert.match(source,/RUNNER_TICK_HEARTBEAT_DIR="\/var\/lib\/disdex\/runner-health\/ticks"/);
 assert.match(source,/\[\[ -d "\$parent" && ! -L "\$parent" \]\]/);
 assert.match(source,/install -d -o deploy -g deploy -m 0700 "\$RUNNER_TICK_HEARTBEAT_DIR"/);
 assert.match(source,/RUNNER_TICK_PERMISSIONS_INVALID/);
 assert.doesNotMatch(source,/chown -R deploy:deploy \/var\/lib\/disdex\/runner-health/);
});
test("all seven exact SHA-scoped trading units gain only the tick path",()=>{
 const expected=["V12_DROPIN_DIR","PENGU_DROPIN_DIR","Q102_DROPIN_DIR","FET_DROPIN_DIR","V52_DROPIN_DIR","IDLE_DROPIN_DIR","HYPE_UNIT"];
 for(const name of expected)assert.match(source,new RegExp(name));
 assert.match(source,/zzzzzzzzzzzzzzzzzz-tick-heartbeat-write\.conf/);
 assert.match(source,/ReadWritePaths=\$\{RUNNER_TICK_HEARTBEAT_DIR\}/);
});
test("operator-only apply installs writable tick directory before systemd reload",()=>{
 const marker=source.indexOf("  ensure_runner_tick_storage\n");
 const reload=source.indexOf("  systemctl daemon-reload",marker);
 assert.ok(marker>0);
 assert.ok(reload>marker);
 assert.ok(source.indexOf("apply_wiring() {")<marker);
});
test("directory symlinks are rejected before any owner change or sandbox override",()=>{
 const from=source.indexOf("ensure_runner_tick_storage() {");
 const to=source.indexOf("apply_wiring() {",from);
 const section=source.slice(from,to);
 assert.match(section,/! -L "\$RUNNER_TICK_HEARTBEAT_DIR"/);
 assert.ok(section.indexOf("RUNNER_TICK_PATH_INVALID")<section.indexOf("install -d -o deploy"));
 assert.ok(section.indexOf("RUNNER_TICK_PERMISSIONS_INVALID")<section.indexOf("for directory"));
});
