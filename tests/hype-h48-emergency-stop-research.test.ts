import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluateH48ResearchEmergencyStop } from "../lib/hype-h48-emergency-stop-research";

const H=3600000;
type Row={split:"TARGET"|"FORWARD";entryTs:number;entryOpen:number;
  exitOpen:number;expectedTime48Raw:number;barOpenLow:[number,number][]};
const evidence=JSON.parse(readFileSync(
  new URL("./fixtures/hype-h48-emergency-stop-h1-20261125.json",import.meta.url),"utf8"
)) as {schema:string;researchSha256:string;hourMs:number;rows:Row[]};
function run(row:Row,stopPct:0|5|8,feeBps:10|30=30) {
  return evaluateH48ResearchEmergencyStop({
    logicalEntryTs:row.entryTs,entryOpen:row.entryOpen,
    logicalExitTs:row.entryTs+48*H,exitOpen:row.exitOpen,
    hours:row.barOpenLow.map(([open,low],i)=>({
      openTs:row.entryTs+i*H,open,low,
    })),
    stopPct,feeBps,
  });
}
function summary(split:"TARGET"|"FORWARD",stopPct:0|5|8) {
  const rows=evidence.rows.filter(x=>x.split===split);
  let equity=10000,peak=10000,drawdown=0,win=0,trigger=0,gap=0;
  for(const trade of rows){
    const x=run(trade,stopPct);
    if(x.netReturn>0)win++;
    trigger+=Number(x.stopTriggered);
    gap+=Number(x.exitReason==="H48_RESEARCH_STOP_GAP_OPEN");
    equity*=1+x.netReturn;
    peak=Math.max(equity,peak);
    drawdown=Math.max(drawdown,100*(1-equity/peak));
  }
  return {count:rows.length,win,trigger,gap,dd:drawdown,equity};
}

test("the 29 ASTER H1 paths exactly reproduce original H48 48h returns",()=>{
  assert.equal(evidence.schema,"disdex-h48-stop-h1-golden/v1");
  assert.equal(evidence.researchSha256,"05632294b05a64c2fe28bbff63d191feed88d0e80e4eb3fd37e7f16bc67977a9");
  assert.equal(evidence.hourMs,H);
  assert.equal(evidence.rows.filter(x=>x.split==="TARGET").length,27);
  assert.equal(evidence.rows.filter(x=>x.split==="FORWARD").length,2);
  for(const row of evidence.rows) {
    assert.equal(row.barOpenLow.length,48);
    const r=run(row,0);
    assert.equal(r.exitReason,"H48_TIME48_NEXTOPEN");
    assert.equal(r.exitPrice,row.exitOpen);
    assert.ok(Math.abs(r.netReturn+0.003-row.expectedTime48Raw)<1e-12);
  }
});

test("historical TARGET H48 STOP8 preserves wins and trims trade-close drawdown slightly",()=>{
  const baseline=summary("TARGET",0),s5=summary("TARGET",5),s8=summary("TARGET",8);
  assert.deepEqual([baseline.count,baseline.win,baseline.trigger],[27,16,0]);
  assert.deepEqual([s5.count,s5.win,s5.trigger],[27,15,8]);
  assert.deepEqual([s8.count,s8.win,s8.trigger,s8.gap],[27,16,2,0]);
  assert.ok(Math.abs(baseline.dd-15.289845143158098)<1e-9);
  assert.ok(Math.abs(s5.dd-14.046074771825257)<1e-9);
  assert.ok(Math.abs(s8.dd-15.10854179147838)<1e-9);
});

test("two-trade FORWARD does NOT independently validate STOP8 improvements",()=>{
  const baseline=summary("FORWARD",0),s5=summary("FORWARD",5),s8=summary("FORWARD",8);
  assert.deepEqual([baseline.count,baseline.win,baseline.trigger],[2,1,0]);
  assert.deepEqual([s5.win,s5.trigger],[1,1]);
  assert.deepEqual([s8.win,s8.trigger],[1,0]);
  assert.equal(s8.equity,baseline.equity);
  assert.ok(s5.equity<baseline.equity);
});

test("gap below -8% can lose MORE than -8%; no fake guaranteed stop fill",()=>{
  const e=Date.UTC(2026,10,24,0);
  const hours=Array.from({length:48},(_,i)=>({
    openTs:e+i*H,open:i===1?90:100,low:i===1?85:100,
  }));
  const v=evaluateH48ResearchEmergencyStop({
    logicalEntryTs:e,entryOpen:100,logicalExitTs:e+48*H,
    exitOpen:120,hours,stopPct:8,feeBps:30,
  });
  assert.equal(v.exitReason,"H48_RESEARCH_STOP_GAP_OPEN");
  assert.equal(v.exitPrice,90);
  assert.ok(Math.abs(v.netReturn-(-0.103))<1e-12);
});

test("missing H1, malformed low or inconsistent entry time fails closed",()=>{
  const row=evidence.rows[0];
  const hours=row.barOpenLow.map(([open,low],i)=>({
    openTs:row.entryTs+i*H,open,low,
  }));
  const input={
    logicalEntryTs:row.entryTs,entryOpen:row.entryOpen,
    logicalExitTs:row.entryTs+48*H,exitOpen:row.exitOpen,
    hours,stopPct:8 as const,feeBps:30 as const,
  };
  assert.throws(()=>evaluateH48ResearchEmergencyStop({...input,hours:hours.slice(1)}),/H48_STOP_RESEARCH_INVALID/);
  assert.throws(()=>evaluateH48ResearchEmergencyStop({...input,hours:hours.map((x,i)=>i===1?{...x,low:x.open+1}:x)}),/H48_STOP_RESEARCH_INVALID/);
  assert.throws(()=>evaluateH48ResearchEmergencyStop({...input,logicalExitTs:input.logicalExitTs+H}),/H48_STOP_RESEARCH_INVALID/);
  assert.throws(()=>evaluateH48ResearchEmergencyStop({...input,entryOpen:input.entryOpen+10}),/H48_STOP_RESEARCH_INVALID/);
});

test("10bps vs 30bps expenses do not change the frozen H48 event or STOP8 entry/exit identity",()=>{
  for(const row of evidence.rows){
    const cheap=run(row,8,10),expensive=run(row,8,30);
    assert.equal(cheap.exitReason,expensive.exitReason);
    assert.equal(cheap.exitPrice,expensive.exitPrice);
    assert.equal(cheap.exitTs,expensive.exitTs);
    assert.ok(Math.abs((cheap.netReturn-expensive.netReturn)-0.002)<1e-12);
  }
});
test("a severe -35% gap proves emergency STOP8 cannot guarantee -8% realized maximum loss",()=>{
  const e=Date.UTC(2026,10,24,0);
  const hours=Array.from({length:48},(_,i)=>({
    openTs:e+i*H,open:i===1?65:100,low:i===1?64:100,
  }));
  const result=evaluateH48ResearchEmergencyStop({
    logicalEntryTs:e,entryOpen:100,logicalExitTs:e+48*H,
    exitOpen:120,hours,stopPct:8,feeBps:30,
  });
  assert.equal(result.exitReason,"H48_RESEARCH_STOP_GAP_OPEN");
  assert.equal(result.exitPrice,65);
  assert.ok(Math.abs(result.netReturn+0.353)<1e-12);
});
test("repeated sideways whipsaws remain losing STOP8 trades; no 70/80% hit-rate claim",()=>{
  const e=Date.UTC(2026,10,24,0);
  for(let n=0;n<20;n++){
    const start=e+n*54*H;
    const hours=Array.from({length:48},(_,i)=>({
      openTs:start+i*H,open:100,low:i===1?91:100,
    }));
    const outcome=evaluateH48ResearchEmergencyStop({
      logicalEntryTs:start,entryOpen:100,logicalExitTs:start+48*H,
      exitOpen:102,hours,stopPct:8,feeBps:30,
    });
    assert.equal(outcome.stopTriggered,true);
    assert.ok(outcome.netReturn<0);
  }
});
