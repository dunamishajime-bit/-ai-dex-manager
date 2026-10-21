import assert from "node:assert/strict";
import test from "node:test";
import {assertUnknownEntryNoVenueExecution} from "../lib/v12-v4-unknown-entry-recovery";

const evidence=(overrides:any={})=>({observedAt:2000,order:{status:"NOT_FOUND",code:-2013 as const},positions:[],openOrders:[],userTrades:[],income:[],...overrides});
const base:any={intents:{cid:{clientOrderId:"cid",legId:"LTCUSDT:r:SHORT:1000",action:"ENTRY",sequence:0,stage:"UNKNOWN",createdAt:1000,updatedAt:1500}},state:{legs:{"LTCUSDT:r:SHORT:1000":{id:"LTCUSDT:r:SHORT:1000",candidate:{symbol:"LTCUSDT",effectiveSide:"SHORT"},status:"PENDING_ENTRY",qty:0}},},protections:{"LTCUSDT:r:SHORT:1000":{legId:"LTCUSDT:r:SHORT:1000",phase:"ENTRY_SENT",updatedAt:1500,protectedQty:0}}};
test("unknown entry recovery accepts only a signed no-venue-execution proof",()=>{
 assert.doesNotThrow(()=>assertUnknownEntryNoVenueExecution(base,"cid",evidence()));
 assert.throws(()=>assertUnknownEntryNoVenueExecution(base,"cid",evidence({openOrders:[{symbol:"LTCUSDT"}]})),/OPEN_ORDER_PRESENT/);
 assert.throws(()=>assertUnknownEntryNoVenueExecution(base,"cid",evidence({userTrades:[{id:1}]})),/TRADE_PRESENT/);
 assert.throws(()=>assertUnknownEntryNoVenueExecution(base,"cid",evidence({positions:[{symbol:"LTCUSDT",positionAmt:"0.1"}]})),/POSITION_PRESENT/);
 assert.throws(()=>assertUnknownEntryNoVenueExecution(base,"cid",evidence({order:{status:"NOT_FOUND",code:-2012}})),/ORDER_EVIDENCE_INVALID/);
});

test("unknown entry recovery also accepts an unsent prepared entry with the same signed no-venue proof",()=>{
 const prepared=structuredClone(base);
 prepared.protections["LTCUSDT:r:SHORT:1000"].phase="ENTRY_PREPARED";
 assert.doesNotThrow(()=>assertUnknownEntryNoVenueExecution(prepared,"cid",evidence()));
});
