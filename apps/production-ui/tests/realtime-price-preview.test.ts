import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateQuotePreview, displayRank, displayScore, formatPrice, provisionalScore,
  rankProvisionalRows, RANKING_PAGE_REFRESH_MS, RANKING_PREVIEW_PERIOD_MS,
} from "../lib/realtime-ranking-preview";
import { rankingPcAlert, type RankRow } from "../lib/realtime-ranking";

const now = 1791529800000;
function row(id:string,score:number|null,side="LONG",changePct?:number):RankRow {
  return {
    id,symbol:id+"USDT",logic:"V12",side,score,gates:[{key:"signal",label:"Signal",state:"OK",detail:"Runner observed"}],
    reason:"formal runner",fresh:score!==null,checkedAt:now-60_000,
    ...(changePct===undefined?{}:{preview:{
      price:100,priceAt:now,referenceAt:now-60000,minuteChangePct:changePct,
      score:provisionalScore(score,side,changePct),status:"ONE_MINUTE_REFERENCE" as const,
    }}),
  };
}
test("UI poll 30 seconds and isolated 60s provisional scoring", () => {
  assert.equal(RANKING_PAGE_REFRESH_MS,30_000);
  assert.equal(RANKING_PREVIEW_PERIOD_MS,60_000);
  assert.equal(provisionalScore(65,"LONG",0.5),71);
  assert.equal(provisionalScore(65,"SHORT",0.5),59);
  assert.equal(provisionalScore(95,"LONG",100),99);
  assert.equal(provisionalScore(3,"LONG",-100),0);
});
test("zero/no formal score, WAIT and missing anchor never invent eligibility",()=>{
  assert.equal(provisionalScore(null,"LONG",1),undefined);
  assert.equal(provisionalScore(70,"WAIT",1),undefined);
  assert.equal(provisionalScore(70,"LONG",undefined),undefined);
  assert.equal(calculateQuotePreview({price:100,priceAt:now,baseline:undefined,baselineAt:undefined,formalScore:65,side:"LONG",now})?.score,undefined);
});
test("quote-only hint refuses stale, negative and incoherent snapshots",()=>{
  assert.equal(calculateQuotePreview({price:100,priceAt:now-100000,baseline:99,baselineAt:now-160000,formalScore:65,side:"LONG",now}),undefined);
  assert.equal(calculateQuotePreview({price:-1,priceAt:now,baseline:99,baselineAt:now-60000,formalScore:65,side:"LONG",now}),undefined);
  assert.equal(calculateQuotePreview({price:101,priceAt:now,baseline:99,baselineAt:now-25000,formalScore:65,side:"LONG",now})?.status,"PRICE_ONLY");
});
test("one minute price estimate is display only; source score and gates unchanged",()=>{
  const before=[row("A",61,"LONG",0.1),row("B",60,"LONG",0.5),row("C",80,"SHORT",-0.1)];
  const old=JSON.stringify(before);
  const after=rankProvisionalRows(before,true);
  assert.deepEqual(after.map(x=>x.id),["C","B","A"]);
  assert.equal(after.find(x=>x.id==="B")?.rank,undefined);
  assert.equal(displayRank(after[0]!,true),1);
  assert.equal(displayScore(after[1]!,true),66);
  assert.equal(after[1]!.score,60);
  assert.equal(JSON.stringify(before),old);
});
test("never notify from a price-only provisional rank change",()=>{
  const before=[row("A",80),row("B",70)];
  const after=before.map(x=>({...x,preview:{price:99,priceAt:now,referenceAt:now-60000,minuteChangePct:10,score:99,status:"ONE_MINUTE_REFERENCE" as const}}));
  assert.equal(rankingPcAlert(before,after),null);
});
test("bad market snapshot does not lower formal signal score",()=>{
  const orig=row("A",78);
  const result=rankProvisionalRows([orig],true);
  assert.equal(displayScore(result[0]!,true),null);
  assert.equal(result[0]!.score,78);
});
test("prices format without scientific notation",()=>{
  assert.equal(formatPrice(0.00812),"0.00812");
  assert.equal(formatPrice(82503.2),"82,503.2");
});
