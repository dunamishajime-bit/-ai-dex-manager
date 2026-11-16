import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync,execFileSync} from "node:child_process";
import {join} from "node:path";

const script=join(process.cwd(),"scripts/stable4-q102-offline-native-parser-check.ts");
const tsx=join(process.cwd(),"node_modules/tsx/dist/cli.mjs");

function invoke(args:string[]){
 const r=spawnSync(process.execPath,[tsx,script,...args],{
   cwd:process.cwd(),encoding:"utf8",timeout:30_000,
   env:{...process.env,DISDEX_STABLE4_MODE:"OFF"},
 });
 if(r.error)throw r.error;
 return r;
}
test("Native Q102 offline evidence audit never permits missing arguments",()=>{
 const r=invoke([]);
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/Q102_NATIVE_ARG_MISSING/);
 assert.doesNotMatch(r.stdout,/PASS_OFFLINE_NATIVE/);
});
test("Native Q102 offline evidence audit rejects non-commit SHA",()=>{
 const r=invoke(["--source-sha","HEAD","--private-root",process.cwd()]);
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/Q102_NATIVE_COMMIT_INVALID/);
 assert.doesNotMatch(r.stdout,/PASS_OFFLINE_NATIVE/);
});
test("Native Q102 offline evidence audit rejects non-temp source roots",()=>{
 const sha=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
 const r=invoke(["--source-sha",sha,"--private-root",process.cwd()]);
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/Q102_NATIVE_NONPRIVATE_ROOT/);
 assert.doesNotMatch(r.stdout,/PASS_OFFLINE_NATIVE/);
});
