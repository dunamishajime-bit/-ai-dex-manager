import assert from "node:assert/strict";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {writeFileSync,readFileSync} from "node:fs";
import {grossForFrame,validateReplay,serializeCsv,type Replay} from "../lib/bt-verification/replay";
import {makeZip} from "../lib/bt-verification/zip-store";

const replay:Replay={
  schema:"disdex-bt-portfolio-v1",mode:"EXTERNAL",seed:0,engineSha:"research-unknown",
  limits:{total:3.5,crypto:3,stock:1.5},
  frames:[{
    timestamp:"2025-10-01T01:00:00Z",btc:null,equity:10022,realized:0,events:["ENTRY V4"],
    gross:{totalX:1.5,cryptoX:1.2,stockX:0.3,source:"bt_equity_snapshot"},
    positions:[
      {id:"p1",logic:"V4",symbol:"BTCUSDT",side:"LONG",quantity:0.02,entry:110000,mark:null,gross:null,grossAtEntry:1.2,openedAt:"2025-10-01T01:00:00Z"}
    ]
  }]
};
assert.equal(validateReplay(replay),true);
const state=grossForFrame(replay.frames[0]);
assert.equal(state.total,1.5);
assert.equal(state.unallocated,1.5);
assert.equal(state.hasAuthoritative,true);
assert.equal(state.inconsistent,false);
const malformed=structuredClone(replay);
malformed.frames[0].gross!.cryptoX=10;
assert.equal(validateReplay(malformed),false);
const bad=structuredClone(replay);
bad.frames[0].positions[0].gross=-2;
assert.equal(validateReplay(bad),false);
const csv=serializeCsv([["a","b"],["quoted \"x\"","line\nbreak"]]);
assert.equal(csv.includes('"quoted ""x"""'),true);
const path=join(tmpdir(),"bt481-replay-unit-test.zip");
const archive=makeZip([
  {name:"manifest.json",content:JSON.stringify({schema:replay.schema})},
  {name:"portfolio_timeline.csv",content:csv}
]);
assert.equal(Buffer.from(archive).subarray(0,4).toString("hex"),"504b0304");
writeFileSync(path,archive);
if(process.argv[2]){
  const loaded:unknown=JSON.parse(readFileSync(process.argv[2],"utf8"));
  assert.equal(validateReplay(loaded),true,"Research replay schema validation");
  const replayLoaded=loaded as Replay;
  assert.ok(replayLoaded.frames.length>1);
  assert.ok((replayLoaded.btcCandles?.length??0)>1);
  assert.ok(replayLoaded.frames.some(f=>grossForFrame(f).hasAuthoritative));
  if(replayLoaded.researchSummary && replayLoaded.strategyStats){
    const totalTrades=replayLoaded.strategyStats.reduce((n,row)=>n+row.tradeCount,0);
    assert.equal(totalTrades,replayLoaded.researchSummary.modelFills,"Research fill count matches logic×symbol breakdown");
    assert.ok(replayLoaded.researchSummary.profitFactor>=0);
    assert.ok(replayLoaded.researchSummary.maxDdPct<=0);
  }
  console.log(JSON.stringify({status:"SOURCE_REPLAY_PASS",frames:replayLoaded.frames.length,
    candles:replayLoaded.btcCandles?.length,stats:replayLoaded.strategyStats?.length,
    reportCostBps:replayLoaded.researchSummary?.costBps}));
}
console.log(JSON.stringify({status:"PASS",tests:7,zipPath:path,zipBytes:archive.length}));
