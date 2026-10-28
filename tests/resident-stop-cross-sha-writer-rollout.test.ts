import test from "node:test";
import assert from "node:assert/strict";
import {observeResidentProtection} from "../lib/resident-stop-observation";
const t=1793196100000;
const sha="7688ed7c93a1918d8b44837339b7da5584a868f5";
const writer="f".repeat(40);
const position:any={symbol:"FETUSDT",positionAmt:"12"};
const order:any={symbol:"FETUSDT",type:"STOP_MARKET",side:"SELL",reduceOnly:true,status:"NEW",origQty:"12",executedQty:"0",stopPrice:"90",clientOrderId:"fet-stop-"+("a".repeat(22))};
const owner:any={runtimeCommitSha:sha,updatedAt:t,position:{symbol:"FETUSDT",side:1,quantity:12,entryPrice:100,stopClientOrderId:order.clientOrderId,hardStop:90}};
test("new risk writer SHA does not lose independently pinned FET protection",()=>{
 const r=observeResidentProtection([position],[order],{FET:owner},writer,t);
 assert.equal(r.unprotectedCount,0);
 assert.equal(r.positions[0].strategy,"FET");
});
test("unknown FET SHA remains unverified rather than inheriting writer's SHA",()=>{
 const r=observeResidentProtection([position],[order],{FET:{...owner,runtimeCommitSha:writer}},writer,t);
 assert.equal(r.unprotectedCount,1);
});
test("foreign Q102 state cannot skip new independent heartbeat, ledger and venue proof",()=>{
 const q102={runtimeCommitSha:"ef1ab178e26a7bf5bddb6473467765edba242e1d",updatedAt:t,position:{symbol:"FETUSDT",side:1,quantity:12,stopClientOrderId:order.clientOrderId,hardStop:90}};
 assert.equal(observeResidentProtection([position],[order],{Q102:q102},writer,t).unprotectedCount,1);
});
test("V12 stale 2026 source is not implicitly trusted because of new writer identity",()=>{
 const stale={...owner,runtimeCommitSha:"bad"};
 assert.equal(observeResidentProtection([position],[order],{FET:stale},sha,t).unprotectedCount,1);
});
test("operator-pinned exact new FET SHA is recognized after separately verified promotion",()=>{
 const promoted="a".repeat(40);
 const newState={...owner,runtimeCommitSha:promoted};
 assert.equal(observeResidentProtection([position],[order],{FET:newState},writer,t,[],[],{FET:promoted}).unprotectedCount,0);
 assert.equal(observeResidentProtection([position],[order],{FET:newState},writer,t).unprotectedCount,1);
});
test("operator pin rejects a bad or untrusted SHA instead of auto trusting state",()=>{
 const promoted="a".repeat(40);
 const newState={...owner,runtimeCommitSha:promoted};
 assert.equal(observeResidentProtection([position],[order],{FET:newState},writer,t,[],[],{FET:"bad"}).unprotectedCount,1);
});
