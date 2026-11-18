import {test} from "node:test";
import {strict as assert} from "node:assert";
import {calculateCapital,contributionEvents} from "../lib/bt-verification/capital-accounting";
test("profit compounds only in compound mode",()=>{
  const events=[{date:"2026-01-01",kind:"REALIZED_PNL" as const,amountJpy:3000}];
  assert.equal(calculateCapital(10000,"COMPOUND",events)[0].sizingBaseJpy,13000);
  assert.equal(calculateCapital(10000,"SIMPLE",events)[0].sizingBaseJpy,10000);
});
test("loss constrains sizing in either mode",()=>{
  const events=[{date:"2026-01-01",kind:"REALIZED_PNL" as const,amountJpy:-4000}];
  for(const mode of ["COMPOUND","SIMPLE"] as const)assert.equal(calculateCapital(10000,mode,events)[0].sizingBaseJpy,6000);
});
test("contributions are not trading profit",()=>{
  const events=[{date:"2026-01-01",kind:"DEPOSIT" as const,amountJpy:5000},{date:"2026-01-02",kind:"REALIZED_PNL" as const,amountJpy:500}];
  const result=calculateCapital(10000,"SIMPLE",events).at(-1)!;
  assert.equal(result.equityJpy,15500);
  assert.equal(result.netDepositsJpy,5000);
  assert.equal(result.tradingPnlJpy,500);
  assert.equal(result.sizingBaseJpy,15000);
});
test("monthly and weekly schedules are explicit",()=>{
  assert.deepEqual(contributionEvents("2026-01-01","2026-03-01",1000,"MONTHLY",1).map(e=>e.date),["2026-01-01","2026-02-01","2026-03-01"]);
  assert.ok(contributionEvents("2026-01-01","2026-01-31",1000,"WEEKLY",1).every(e=>new Date(e.date+"T00:00:00Z").getUTCDay()===1));
});
test("invalid money and schedule fail closed",()=>{
  assert.throws(()=>calculateCapital(0,"SIMPLE",[]),/INVALID_INITIAL/);
  assert.throws(()=>contributionEvents("2026-01-01","2026-01-31",-1,"MONTHLY",1),/INVALID_DEPOSIT/);
});