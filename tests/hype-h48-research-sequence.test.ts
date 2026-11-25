import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createH48ResearchSequence, validateH48ResearchSequence, advanceH48ResearchSequence,
  type H48ResearchSequence,
} from "../lib/hype-h48-research-sequence";
import { H48_RESEARCH_GRID_MS, H48_RESEARCH_HOUR_MS, type H48ClosedHour } from "../lib/hype-h48-research-entry";

const SHA="4786f600ae7bf86ffca948f1412956a9113cb20d";
const H=H48_RESEARCH_HOUR_MS;
type Event={ entryTs:number;entryOpen:number;hypeCloses:number[];btcCloses:number[] };
const fixture=JSON.parse(readFileSync(new URL("./fixtures/hype-h48-r4-base-event-golden-20261114.json",import.meta.url),"utf8")) as {
  schema:string;sha256:string;startEntryTs:number;lastEntryTs:number;baseCandidates:Event[];expectedResearchSelected:number[];
};
const makeCloses=(e:number,closes:number[]):H48ClosedHour[]=>closes.map((close,i)=>({
  openTs:e-(25-i)*H,close,
}));
function entryInput(e:number,v?:Event){
  const same=Array<number>(25).fill(100);
  return {
    runtimeSha:SHA,now:e+10_000,
    entry:{openTs:e,open:v?.entryOpen??100,observedAt:e+5_000},
    hypeClosed:makeCloses(e,v?.hypeCloses??same),
    btcClosed:makeCloses(e,v?.btcCloses??same),
    existingHypePosition:false,
  };
}

test("complete six-hour timeline has 84 BASE, 62 nonoverlapping BASE and exactly 27 original WSIG",()=>{
  assert.equal(fixture.schema,"disdex-h48-r4-base-event-golden/v1");
  assert.equal(fixture.sha256,"05632294b05a64c2fe28bbff63d191feed88d0e80e4eb3fd37e7f16bc67977a9");
  assert.equal(fixture.baseCandidates.length,84);
  assert.equal(fixture.expectedResearchSelected.length,27);
  const byTs=new Map(fixture.baseCandidates.map(x=>[x.entryTs,x]));
  assert.equal(byTs.size,84);
  let state=createH48ResearchSequence(SHA);
  const selected:number[]=[];
  let baseSelected=0, filtered=0, skipped=0;
  for(let e=fixture.startEntryTs;e<=fixture.lastEntryTs;e+=H48_RESEARCH_GRID_MS){
    const result=advanceH48ResearchSequence({state,...entryInput(e,byTs.get(e))});
    state=validateH48ResearchSequence(JSON.parse(JSON.stringify(result.state)),SHA);
    if(result.decision.status==="RESEARCH_CANDIDATE"){
      selected.push(e);baseSelected++;
    }else if(result.decision.status==="BASE_ACCEPTED_WSIG_REJECTED"){
      baseSelected++;filtered++;
    }else if(result.decision.status==="BASE_WINDOW_SKIP"&&byTs.has(e)){
      skipped++;
    }else if(result.decision.status==="NO_BASE_SIGNAL"&&byTs.has(e)){
      assert.fail("original base event incorrectly rejected: "+e);
    }
  }
  assert.equal(baseSelected,62);
  assert.equal(filtered,35);
  assert.equal(skipped,22);
  assert.deepEqual(selected,fixture.expectedResearchSelected);
});

test("WSIG-first ordering would wrongly add unapproved candidates",()=>{
  const byTs=new Map(fixture.baseCandidates.map(x=>[x.entryTs,x]));
  let nextAfterTraded=0,wrong:number[]=[];
  for(let e=fixture.startEntryTs;e<=fixture.lastEntryTs;e+=H48_RESEARCH_GRID_MS){
    const source=byTs.get(e);
    if(!source||e<nextAfterTraded)continue;
    const state=createH48ResearchSequence(SHA);
    const decision=advanceH48ResearchSequence({state,...entryInput(e,source)}).decision;
    if(decision.status==="RESEARCH_CANDIDATE"){
      wrong.push(e);nextAfterTraded=e+48*H;
    }
  }
  assert.equal(wrong.length,31);
  assert.ok(wrong.some(x=>!fixture.expectedResearchSelected.includes(x)));
});

test("replay, skipped six-hour grid and incorrect or forged state all fail closed",()=>{
  const first=fixture.startEntryTs;
  const state=createH48ResearchSequence(SHA);
  const result=advanceH48ResearchSequence({state,...entryInput(first)});
  assert.throws(()=>advanceH48ResearchSequence({state:result.state,...entryInput(first)}),
    /H48_SEQUENCE_MISSING_OR_REPEATED_GRID/);
  assert.throws(()=>advanceH48ResearchSequence({state:result.state,...entryInput(first+2*H48_RESEARCH_GRID_MS)}),
    /H48_SEQUENCE_MISSING_OR_REPEATED_GRID/);
  assert.throws(()=>validateH48ResearchSequence({...result.state,sourceSha:"a".repeat(40)},SHA),
    /H48_SEQUENCE_STATE_INVALID/);
  assert.throws(()=>validateH48ResearchSequence({...result.state,nextBaseEligibleTs:first+100*H},SHA),
    /H48_SEQUENCE_STATE_INVALID/);
  assert.throws(()=>validateH48ResearchSequence({...result.state,untrustedPermit:true},SHA),
    /H48_SEQUENCE_STATE_INVALID/);
});

test("once a BASE candidate passes, its 48-hour research lockout persists even when WSIG rejects",()=>{
  const byTs=new Map(fixture.baseCandidates.map(x=>[x.entryTs,x]));
  let state=createH48ResearchSequence(SHA);
  let sawFiltered=false,sawBlockedAfterFiltered=false,filteredUntil=0;
  for(let e=fixture.startEntryTs;e<=fixture.lastEntryTs;e+=H48_RESEARCH_GRID_MS){
    const result=advanceH48ResearchSequence({state,...entryInput(e,byTs.get(e))});
    state=result.state;
    if(result.decision.status==="BASE_ACCEPTED_WSIG_REJECTED"){
      sawFiltered=true;
      filteredUntil=e+48*H;
    }else if(result.decision.status==="BASE_WINDOW_SKIP"&&e<filteredUntil&&byTs.has(e)){
      sawBlockedAfterFiltered=true;
    }
  }
  assert.ok(sawFiltered);
  assert.ok(sawBlockedAfterFiltered);
});
