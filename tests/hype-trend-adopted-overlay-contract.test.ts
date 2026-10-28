import assert from "node:assert/strict";
import test from "node:test";
import {advanceHypeAdoptedM5Exit,evaluateHypeAdoptedM5Entry} from "../lib/hype-trend-adopted-overlay";
const M5=300_000,T=Math.floor(1793000000000/300_000)*300_000;
const bars=(last:number)=>Array.from({length:37},(_,i)=>{
 const p=i===36?last:100;
 return {openTime:T+i*M5,open:p,high:p*1.001,low:p*0.999,close:p};
});
test("entry permits completed M5 only with BTC3h<=0.6 and HYPE3h relative>=2pp",()=>{
 const b=bars(100.5),h=bars(103.2);
 const got=evaluateHypeAdoptedM5Entry({btc:b,hype:h,decisionTs:T+37*M5});
 assert.equal(got.accepted,true,JSON.stringify(got));
});
test("BTC +3% fails entry despite strong HYPE",()=>{
 const got=evaluateHypeAdoptedM5Entry({btc:bars(103),hype:bars(108),decisionTs:T+37*M5});
 assert.equal(got.accepted,false);
 assert.equal(got.reason,"HYPE_ADOPTED_BTC3H_TOO_STRONG");
});
test("HYPE relative strength below 2pp fails",()=>{
 const got=evaluateHypeAdoptedM5Entry({btc:bars(100.5),hype:bars(101),decisionTs:T+37*M5});
 assert.equal(got.reason,"HYPE_ADOPTED_RELATIVE_3H_TOO_WEAK");
});
test("uncompleted extra candle is never used",()=>{
 const btc=[...bars(100.5),{openTime:T+37*M5,open:100.5,high:500,low:100,close:500}];
 const hype=bars(103.2);
 assert.equal(evaluateHypeAdoptedM5Entry({btc,hype,decisionTs:T+37*M5}).accepted,true);
});
test("missing 3h history, missing bar, duplicate and BTC/HYPE offset all fail",()=>{
 const btc=bars(100.5),hype=bars(103.2),ts=T+37*M5;
 assert.equal(evaluateHypeAdoptedM5Entry({btc:btc.slice(2),hype,decisionTs:ts}).accepted,false);
 assert.equal(evaluateHypeAdoptedM5Entry({btc:btc.filter((_,i)=>i!==30),hype,decisionTs:ts}).accepted,false);
 assert.equal(evaluateHypeAdoptedM5Entry({btc:[...btc.slice(0,35),btc[35],btc[35]],hype,decisionTs:ts}).accepted,false);
 assert.equal(evaluateHypeAdoptedM5Entry({btc,hype:hype.map(x=>({...x,openTime:x.openTime+M5})),decisionTs:ts+M5}).accepted,false);
});
test("the active incomplete close cannot masquerade as prior completed candle",()=>{
 const btc=bars(100.5).map(x=>({...x,openTime:x.openTime+M5}));
 assert.equal(evaluateHypeAdoptedM5Entry({btc,hype:bars(103.2),decisionTs:T+37*M5}).accepted,false);
});
const s=()=>({maxFavorablePct:0,profitArmReached:false});
const bar=(n:number,cl:number,high=cl)=>({openTime:T+n*M5,open:100,high,low:Math.min(cl,100)-0.01,close:cl});
test("MFE<0.3 and loss below -1 after >=1h closes initial exit",()=>{
 const v=advanceHypeAdoptedM5Exit({entryTs:T,entryPrice:100,now:T+13*M5,bar:bar(12,98.9,100.1),state:s()});
 assert.equal(v.exit,true);assert.equal(v.reason,"HYPE_ADOPTED_INITIAL_1H_MINUS1P0");
});
test("no early stop before one hour",()=>{
 const v=advanceHypeAdoptedM5Exit({entryTs:T,entryPrice:100,now:T+8*M5,bar:bar(7,98.8,100.1),state:s()});
 assert.equal(v.exit,false);
});
test("positive MFE >=0.3 avoids early loss stop",()=>{
 const v=advanceHypeAdoptedM5Exit({entryTs:T,entryPrice:100,now:T+13*M5,bar:bar(12,98.8,100.4),state:s()});
 assert.equal(v.exit,false);
});
test("profit arm occurs at +3% completed close but no same-bar retroactive exit",()=>{
 const v=advanceHypeAdoptedM5Exit({entryTs:T,entryPrice:100,now:T+2*M5,bar:bar(1,103,103.1),state:s()});
 assert.equal(v.exit,false);assert.equal(v.state.profitArmReached,true);
});
test("after +3% arm profit is protected at +1.5% quote close",()=>{
 const v=advanceHypeAdoptedM5Exit({entryTs:T,entryPrice:100,now:T+3*M5,bar:bar(2,101.4,103),state:{maxFavorablePct:3.1,profitArmReached:true,lastCompletedM5Ts:T+M5}});
 assert.equal(v.exit,true);assert.equal(v.reason,"HYPE_ADOPTED_PROFIT_3P0_TO_1P5");
});
test("same completed M5 replay is rejected",()=>{
 const v=advanceHypeAdoptedM5Exit({entryTs:T,entryPrice:100,now:T+3*M5,bar:bar(1,100),state:{maxFavorablePct:0,profitArmReached:false,lastCompletedM5Ts:T+M5}});
 assert.equal(v.accepted,false);assert.equal(v.reason,"HYPE_ADOPTED_M5_REPLAY_OR_DUPLICATE");
});
test("M5 gap and invalid timestamps fail closed",()=>{
 const v=advanceHypeAdoptedM5Exit({entryTs:T,entryPrice:100,now:T+4*M5,bar:bar(3,100),state:{maxFavorablePct:0,profitArmReached:false,lastCompletedM5Ts:T+M5}});
 assert.equal(v.accepted,false);
});
test("pre-entry bar does not contaminate favorable excursion",()=>{
 const v=advanceHypeAdoptedM5Exit({entryTs:T+2*M5,entryPrice:100,now:T+3*M5,bar:bar(1,103,120),state:s()});
 assert.equal(v.accepted,false);
});
test("improperly low MFE state and invalid high/low fail",()=>{
 const a=advanceHypeAdoptedM5Exit({entryTs:T,entryPrice:100,now:T+2*M5,bar:bar(1,103),state:{maxFavorablePct:-1,profitArmReached:false}});
 assert.equal(a.accepted,false);
});
