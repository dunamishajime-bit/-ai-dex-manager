/** Validate private research-only baseline exports without uploading model ledgers. */
import {readFileSync,readdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {validateReplay} from "../../lib/bt-verification/replay";
const dir=process.argv[2];
if(!dir)throw new Error("USAGE: tsx scripts/research/verify_bt_baseline_exports.ts <private-dir>");
const manifest=JSON.parse(readFileSync(join(dir,"MANIFEST_UNCERTIFIED.json"),"utf8"));
if(manifest.integrated_eight_runner!==false||manifest.production_parity_verified!==false)
  throw new Error("UNSAFE_CERTIFICATION");
if(!Array.isArray(manifest.exports)||manifest.exports.length!==6)throw new Error("MISSING_SIX_SCENARIOS");
for(const item of manifest.exports){
 if(!/^[\w-]+\.json$/.test(item.file))throw new Error("INVALID_FILE");
 const contents=readFileSync(join(dir,item.file));
 const hash=createHash("sha256").update(contents).digest("hex");
 if(hash!==item.sha256)throw new Error("EXPORT_HASH_MISMATCH");
 const replay:unknown=JSON.parse(contents.toString("utf8"));
 if(!validateReplay(replay))throw new Error("INVALID_REPLAY "+item.file);
 if(replay.source?.kind!=="HISTORICAL_STANDALONE_MODEL_NOT_INTEGRATED")
   throw new Error("INVALID_RESEARCH_PROVENANCE");
 if(replay.frames.some(f=>f.positions.length>0))throw new Error("FABRICATED_HOLDINGS");
 if(replay.frames.length!==item.frames)throw new Error("FRAME_COUNT_MISMATCH");
 console.log("PASS",item.strategy,item.bps+"bps",item.frames+" frames");
}
const extras=readdirSync(dir).filter(name=>name.startsWith("disdex-baseline-") && name.endsWith("UNCERTIFIED.json"));
if(extras.length!==6)throw new Error("EXTRA_EXPORTS");
console.log("PASS: 6 standalone baseline model replays validated; integrated 8-runner BT NOT certified");