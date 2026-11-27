/** Single capture only. Run independently of Runner account locks. */
import {captureObservation,writeObservation} from "../lib/stable4-observation-snapshot";
import {loadR21PublicObservation} from "../lib/stable4-r21-public-observation-feed";
import {loadP91PublicObservation} from "../lib/stable4-p91-public-observation-feed";
async function main(){
 const args=process.argv.slice(2),sha=args[0],path=args[1];
 if(args.length!==2||!sha||!path)throw Error("usage: stable4-market-observe <source-sha> <observation-output.json>");
 const s=await captureObservation({sourceSha:sha,now:Date.now,loadR21:async at=>(await loadR21PublicObservation(at))?.candidates,loadP91:loadP91PublicObservation});
 await writeObservation(path,s);
 console.log(JSON.stringify({mode:s.mode,orderEnabled:false,decisionTs:s.decisionTs,r21:s.r21.status,candidateCount:s.r21.candidates.length,p91:s.p91.status}));
}
main().catch(e=>{console.error(String(e));process.exitCode=1});
