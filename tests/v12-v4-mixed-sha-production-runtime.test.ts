import test from "node:test";
import assert from "node:assert/strict";
import { resolveV12PrimaryReleaseSha } from "../lib/server/current-production-runtime";
const OLD="e8cc2e73f8d3981d708ee52f013241597c038b10";
const NEW="6f97d2cf03877674ec1a845f6c08414f32899f36";

test("independent certified V4 release is used only for V12, not the peer release",()=>{
 const p=resolveV12PrimaryReleaseSha(OLD,"V4",{
  DISDEX_V12_V4_PRIMARY_SHA:NEW,DISDEX_V12_V4_PEER_SHA:OLD,
 });
 assert.equal(p,NEW);
 assert.equal(resolveV12PrimaryReleaseSha(OLD,"LEGACY",{}),OLD);
 assert.equal(resolveV12PrimaryReleaseSha(OLD,"V4",{
  DISDEX_V12_V4_PRIMARY_SHA:OLD,DISDEX_V12_V4_PEER_SHA:OLD,
 }),OLD);
});

test("mixed V4 release never silently falls back to a mismatched or missing peer pin",()=>{
 for(const e of [
  {DISDEX_V12_V4_PRIMARY_SHA:NEW},
  {DISDEX_V12_V4_PRIMARY_SHA:NEW,DISDEX_V12_V4_PEER_SHA:NEW},
  {DISDEX_V12_V4_PRIMARY_SHA:"incorrect",DISDEX_V12_V4_PEER_SHA:OLD},
  {DISDEX_V12_V4_PEER_SHA:OLD},
 ])assert.throws(()=>resolveV12PrimaryReleaseSha(OLD,"V4",e),/CURRENT_V12_PRIMARY_SHA_MISMATCH/);
});
