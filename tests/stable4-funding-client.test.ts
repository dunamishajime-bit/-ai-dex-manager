import test from "node:test";
import assert from "node:assert/strict";
import {AsterV3Client} from "../lib/aster-v3-client";
test("funding history uses the unsigned public V3 GET and inclusive bounded range",async()=>{
 const calls:{url:string;init:any}[]=[];
 const client=new AsterV3Client({fetchImpl:async(input,init)=>{calls.push({url:String(input),init});return new Response(JSON.stringify([{symbol:"SUIUSDT",fundingTime:1000,fundingRate:".0001"}]),{status:200});}});
 const method=(client as any).getFundingRateHistory;assert.equal(typeof method,"function");
 const rows=await method.call(client,"SUIUSDT",1000,{startTime:1000,endTime:2000});
 assert.equal(rows[0].fundingTime,1000);assert.equal(calls.length,1);
 const url=new URL(calls[0].url);assert.equal(url.pathname,"/fapi/v3/fundingRate");
 assert.equal(url.searchParams.get("startTime"),"1000");assert.equal(url.searchParams.get("endTime"),"2000");
 assert.equal(calls[0].init.method,"GET");assert.equal(url.searchParams.has("signature"),false);assert.equal(calls[0].init.body,undefined);
});
