import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const root=process.cwd();
const read=(p:string)=>readFileSync(join(root,p),"utf8");

test("health snapshot has explicit V4 mode while legacy remains default",()=>{
 const s=read("scripts/ops/root/disdex-runner-health-snapshot-current.mjs");
 assert.match(s,/DISDEX_HEALTH_SNAPSHOT_V12_VARIANT \|\| "LEGACY"/);
 assert.match(s,/key: "V12_V4"/);
 assert.match(s,/disdex-v12-v4@/);
 assert.match(s,/scripts\/v12-v4-production-runner\.ts/);
 assert.match(s,/\/var\/lib\/disdex\/v12-v4\/orders\.json/);
 assert.match(s,/state\?\.schema === 2/);
});

test("watchdog V4 mode restarts only V4 and fails on noninactive legacy V12",()=>{
 const s=read("scripts/ops/root/disdex-runner-watchdog-current.mjs");
 assert.match(s,/key: "V12_V4"/);
 assert.match(s,/expectedUnit: \(sha\) => `disdex-v12-v4@\$\{sha\}\.service`/);
 assert.match(s,/watchdog V12 variant is invalid/);
 assert.match(s,/V4_LEGACY_V12_PINNED_CONFLICT/);
 assert.match(s,/disdex-v12-x1-all@\*\.service/);
});

test("V4 monitoring wiring persistently retires legacy restart paths",()=>{
 const s=read("scripts/ops/root/disdex-v12-v4-monitoring-wiring");
 assert.match(s,/DISDEX_HEALTH_SNAPSHOT_V12_VARIANT=V4/);
 assert.match(s,/DISDEX_WATCHDOG_V12_VARIANT=V4/);
 assert.match(s,/systemctl disable --now disdex-runner-position-recovery\.timer/);
 assert.match(s,/systemctl disable --now disdex-v12-three-hour-health-check\.timer/);
 assert.match(s,/systemctl disable --now disdex-v12-kill-switch-auto-repair\.path/);
 assert.match(s,/systemctl mask "\$u"/);
 assert.match(s,/\/etc\/systemd\/system\/disdex-v12-x1-all@\$LEGACY_SHA\.service/);
 assert.match(s,/disdex-v12-v4-legacy-retirement\/v1/);
});

test("coherence guard preserves V4 ownership and refuses old support contract",()=>{
 const s=read("scripts/ops/root/disdex-current-runtime-coherence-guard");
 assert.match(s,/DISDEX_V12_RUNTIME_VARIANT/);
 assert.match(s,/FAMILIES\[0\]="disdex-v12-v4"/);
 assert.match(s,/HEARTBEATS\[0\]="v12-v4\.json"/);
 assert.match(s,/DISDEX_HEALTH_SNAPSHOT_V12_VARIANT=V4/);
 assert.match(s,/DISDEX_WATCHDOG_V12_VARIANT=V4/);
 assert.match(s,/disdex-v12-v4-monitoring-wiring/);
 assert.match(s,/positionRecoveryDisabled/);
 assert.match(s,/v12AutoRepairDisabled/);
 assert.match(s,/v12ThreeHourHealthDisabled/);
});

test("health alert accepts only SHA-bound explicit V4 override",()=>{
 const s=read("scripts/ops/root/disdex-runner-health-alert.ts");
 assert.match(s,/disdex-v12-x1-all\|disdex-v12-v4/);
 assert.match(s,/SHA-bound service override/);
 assert.match(s,/process\.env\[runner\.unitEnv\]/);
});
