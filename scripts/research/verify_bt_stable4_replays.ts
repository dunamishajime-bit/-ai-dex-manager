/** Validate locally exported STABLE4 research replay(s), source provenance and no-LIVE semantics. */
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {validateReplay} from "../../lib/bt-verification/replay";
import {portfolioMetrics} from "../../lib/bt-verification/portfolio-metrics";
const dir=process.argv[2];
if(!dir)throw new Error("USAGE: tsx scripts/research/verify_bt_stable4_replays.ts <private-dir>");
const manifest=JSON.parse(readFileSync(join(dir,"MANIFEST_UNCERTIFIED.json"),"utf8"));
if(manifest.schema!=="disdex-private-stable4-research-replays/v1"||
   manifest.production_parity_verified!==false||manifest.integrated_eight_runner!==false||
   manifest.actual_exchange_fills_verified!==false||
   !Array.isArray(manifest.exports)||manifest.exports.length!==2)throw new Error("UNSAFE_MANIFEST");
for(const entry of manifest.exports){
 if(!/^disdex-baseline-STABLE4-research-(10|30)bps-UNCERTIFIED\.json$/.test(entry.file))
   throw new Error("BAD_STABLE4_FILE");
 const bytes=readFileSync(join(dir,entry.file));
 if(createHash("sha256").update(bytes).digest("hex")!==entry.sha256)throw new Error("OUTPUT_HASH_MISMATCH");
 const replay:unknown=JSON.parse(bytes.toString("utf8"));
 if(!validateReplay(replay))throw new Error("INVALID_STABLE4_REPLAY "+entry.file);
 if(replay.source?.kind!=="HISTORICAL_STABLE4_RESEARCH_NOT_PRODUCTION"||
   replay.mode!=="EXTERNAL"||replay.researchSummary?.costBps!==entry.bps||
   replay.researchSummary.modelFills!==entry.modelFills||
   replay.frames.some(f=>f.positions.length!==0))throw new Error("UNVERIFIED_LIVE_CLAIM");
 const metric=portfolioMetrics(replay.frames,replay.frames.length-1);
 if(Math.abs(metric.current-replay.researchSummary.finalEquityJpy)>0.01)
   throw new Error("SOURCE_TERMINAL_MTM_MISMATCH");
 console.log("PASS",entry.bps+"bps",entry.frames+" frames", "source DD",entry.researchMaxDdPct,
   "sampled DD",metric.maxDD.toFixed(4));
}
console.log("PASS: STABLE4 study portfolio replays validated as RESEARCH ONLY, NOT LIVE parity");