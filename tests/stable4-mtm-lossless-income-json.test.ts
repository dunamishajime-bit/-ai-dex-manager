import test from "node:test";
import assert from "node:assert/strict";
import {parseLosslessIncomeJson} from "../lib/stable4-mtm-lossless-income-json";
test("original large funding IDs retain every digit, distinct adjacent IDs remain distinct",()=>{
 const raw='[{"tranId":9007199254740992,"income":"0.0021","time":1795850000000},{"tranId":9007199254740993}]';
 const x=parseLosslessIncomeJson(raw) as any[];
 assert.equal(x[0].tranId,"9007199254740992");
 assert.equal(x[1].tranId,"9007199254740993");
 assert.equal(x[0].time,1795850000000);
 assert.equal(x[0].income,"0.0021");
});
test("quoted tokens, escaped quotes, decimals and safe integers are unchanged",()=>{
 const raw=JSON.stringify({note:'"tranId":9007199254740993',tranId:"9007199254740993",decimal:0.125,safe:9007199254740991});
 assert.deepEqual(parseLosslessIncomeJson(raw),JSON.parse(raw));
});
test("nested numeric IDs and signed integers are preserved exactly",()=>{
 assert.deepEqual(parseLosslessIncomeJson('{"rows":[{"tranId":-9007199254740993,"tradeId":10000000000000000001}]}'),{rows:[{tranId:"-9007199254740993",tradeId:"10000000000000000001"}]});
});
test("malformed and unsafe exponent tokens fail closed",()=>{
 for(const raw of ['{"x":01}','{"x":1e309}','{"x":9e20}','{"x":9007199254740993.0}'])assert.throws(()=>parseLosslessIncomeJson(raw));
});
