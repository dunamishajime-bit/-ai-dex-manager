import test from "node:test";
import assert from "node:assert/strict";
import {createPreviewReplay} from "../lib/bt-verification/demo";
import {validateReplay, type StrategyRouteStat} from "../lib/bt-verification/replay";

const stat:StrategyRouteStat={
 logic:"V4",route:"REC_X04_TIME_24H",symbol:"BTCUSDT",tradeCount:10,
 closedCount:9,wins:6,netPnlJpy:-1234,maxLossJpy:-500,
 winRatePct:66.6667,adverseExitCount:3,netLossCount:3,
};
const preview=createPreviewReplay(123456,"trend");
test("route detail is optional for existing demo and historical replay",()=>{
 assert.equal(validateReplay(preview),true);
});
test("valid route-level model count and loss diagnostics can be imported",()=>{
 assert.equal(validateReplay({...preview,strategyRouteStats:[stat]}),true);
});
test("route detail rejects malformed counts and duplicate key",()=>{
 assert.equal(validateReplay({...preview,strategyRouteStats:[{...stat,closedCount:11}]}),false);
 assert.equal(validateReplay({...preview,strategyRouteStats:[{...stat,adverseExitCount:11}]}),false);
 assert.equal(validateReplay({...preview,strategyRouteStats:[stat,{...stat}]}),false);
 assert.equal(validateReplay({...preview,strategyRouteStats:[{...stat,route:""}]}),false);
});
test("route detail fails closed on nonfinite model pnl",()=>{
 assert.equal(validateReplay({...preview,strategyRouteStats:[{...stat,netPnlJpy:Number.NaN}]}),false);
});
