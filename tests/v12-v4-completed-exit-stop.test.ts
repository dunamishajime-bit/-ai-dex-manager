import test from "node:test";
import assert from "node:assert/strict";
import {attestV4CompletedExitMissingStop} from "../lib/v12-v4-stop-retirement";
const input:any={
 state:{legs:{leg:{status:"CLOSED",qty:0,candidate:{symbol:"XRPUSDT",effectiveSide:"SHORT"}}}},
 intents:{stop:{legId:"leg",action:"STOP",clientOrderId:"stop",venueOrderId:"123",command:{quantity:15.7,price:1.034}}},
 legId:"leg",stopClientOrderId:"stop",
 proof:{orderId:123,clientOrderId:"stop",symbol:"XRPUSDT",type:"STOP_MARKET",reduceOnly:true,side:"BUY",status:"EXPIRED",origQty:"15.7",executedQty:"0",stopPrice:"1.034"},
};
test("only exact signed unused terminal STOP evidence can retire an already filled EXIT",()=>{
 for(const status of ["EXPIRED","CANCELED","REJECTED"])assert.doesNotThrow(()=>attestV4CompletedExitMissingStop({...input,proof:{...input.proof,status}}));
 const invalid=[undefined,...[
  {status:"NEW"},{status:"FILLED"},{status:"PARTIALLY_FILLED"},{clientOrderId:"other"},{orderId:999},
  {symbol:"SOLUSDT"},{type:"LIMIT"},{reduceOnly:false},{side:"SELL"},{executedQty:".1"},{origQty:"15"},{stopPrice:"1.035"},
 ].map(x=>({...input.proof,...x}))];
 for(const proof of invalid)assert.throws(()=>attestV4CompletedExitMissingStop({...input,proof}),/NOT_ATTESTED|TRIGGER_MISMATCH/);
 assert.throws(()=>attestV4CompletedExitMissingStop({...input,state:{legs:{leg:{...input.state.legs.leg,qty:1}}}}),/NOT_ATTESTED/);
});
