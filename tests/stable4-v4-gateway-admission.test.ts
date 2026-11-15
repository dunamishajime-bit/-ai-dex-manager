import test from "node:test";
import assert from "node:assert/strict";
import {createV4AsterOrderGateway} from "../lib/v12-v4-durable-orders";
import {Stable4EntryGrossAdmissionError} from "../lib/stable4-entry-gross-guard";
import {MarketPreSubmitEntryError} from "../lib/market-pre-submit-entry-error";
test("V4 gateway carries its actual lease and replay reader and binds a definite entry cap rejection",async()=>{
 const old=process.env.DISDEX_STABLE4_MODE;process.env.DISDEX_STABLE4_MODE="LIVE";
 try{
  const lease={document:async()=>({})},readDocument=()=>({}),input={signalTs:1800000000000,symbol:"BTCUSDT",side:"LONG" as const,quantity:1,expectedPrice:100,clientOrderId:"v4-entry"};let received:any;
  const adapter:any={executeEntry:async(value:any)=>{received=value;throw new Stable4EntryGrossAdmissionError("CRYPTO_CAP_EXCEEDED");}};
  const gateway=createV4AsterOrderGateway(adapter,{lease,readDocument} as any);
  await assert.rejects(()=>gateway.executeEntry(input),e=>e instanceof MarketPreSubmitEntryError&&e.clientOrderId===input.clientOrderId&&e.symbol===input.symbol);
  assert.equal(received.stable4Admission.lease,lease);assert.equal(received.stable4Admission.ownReservationId,input.clientOrderId);assert.equal(received.stable4Admission.v4Reservation.readDocument,readDocument);
 }finally{if(old===undefined)delete process.env.DISDEX_STABLE4_MODE;else process.env.DISDEX_STABLE4_MODE=old;}
});
