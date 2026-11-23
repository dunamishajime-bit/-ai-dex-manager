import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function rankingRefreshUnit(currentSha,snapshot){
 const sha=String(currentSha).trim().toLowerCase();
 if(!/^[0-9a-f]{40}$/.test(sha))throw Error('CURRENT_RELEASE_SHA_INVALID');
 if(snapshot?.strategyId!=='QUALITY102_CAUSAL_V1'||snapshot?.selectorMode!=='CAUSAL_V4'||String(snapshot.runtimeCommitSha).toLowerCase()!==sha)return null;
 return 'disdex-quality102-ranking-observer@'+sha+'.service';
}
async function main(){
 const sha=await readFile('/home/deploy/disdex-trading/current/.disdex-release-sha','utf8');
 const snapshot=JSON.parse(await readFile('/var/lib/disdex/quality102-causal-v1/decision-snapshot.json','utf8'));
 const unit=rankingRefreshUnit(sha,snapshot);
 if(!unit){console.log('Q102_RANKING_REFRESH_DEFERRED_OLD_DECISION');return;}
 const result=spawnSync('/usr/bin/systemctl',['start',unit],{encoding:'utf8',timeout:110000});
 if(result.error||result.status!==0)throw Error('Q102_RANKING_REFRESH_FAILED:'+unit+':'+(result.error?.message||result.stderr));
 console.log(JSON.stringify({status:'Q102_RANKING_REFRESH_OK',unit,readOnly:true,tradingMutation:0}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
