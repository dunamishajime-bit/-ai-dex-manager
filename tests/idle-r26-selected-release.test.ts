import test from "node:test";
import assert from "node:assert/strict";
import {resolveIdleR26EntrySelection} from "../lib/idle-r26-entry-certificate";
test("selected R26 LIVE without approval must hold new entries, not restore legacy",()=>{
 assert.deepEqual(resolveIdleR26EntrySelection({mode:"LIVE",required:true,certifiedFlag:false}),
  {applyR26:true,requireCertificate:true,held:true,allowIndependentRender:false});
});
test("R26 LIVE explicitly selected and flag set still requires independent root certificate",()=>{
 assert.deepEqual(resolveIdleR26EntrySelection({mode:"LIVE",required:true,certifiedFlag:true}),
  {applyR26:true,requireCertificate:true,held:false,allowIndependentRender:false});
 assert.deepEqual(resolveIdleR26EntrySelection({mode:"LIVE",required:false,certifiedFlag:true}),
  {applyR26:true,requireCertificate:true,held:false,allowIndependentRender:false});
});
test("R26 monitor-only never requires LIVE certificate; no unrelated independent RENDER",()=>{
 assert.deepEqual(resolveIdleR26EntrySelection({mode:"SHADOW",required:true,certifiedFlag:false}),
  {applyR26:true,requireCertificate:false,held:false,allowIndependentRender:false});
});
test("legacy currently authorized release remains unchanged when new R26 is not selected",()=>{
 assert.deepEqual(resolveIdleR26EntrySelection({mode:"LIVE",required:false,certifiedFlag:false}),
  {applyR26:false,requireCertificate:false,held:false,allowIndependentRender:true});
});
