import { copyFile, readFile, stat, chown, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { AsterV3Client } from '../lib/aster-v3-client';
import { readFetBrk48State, writeFetBrk48State, type FetBrk48State } from '../lib/fet-brk48-state';
import { migrateFlatRuntimeState } from './disdex-flat-state-sha-migrate';

export function assertFetMigrationProof(state:FetBrk48State,positions:readonly Record<string,unknown>[],orders:readonly Record<string,unknown>[]) {
 const active=positions.filter(r=>r.symbol==='FETUSDT'&&Math.abs(Number(r.positionAmt))>1e-12);
 const stopOrders=orders.filter(r=>r.symbol==='FETUSDT');const p=state.position;
 if(!p) {if(active.length||stopOrders.length)throw new Error('FET_MIGRATION_FLAT_VENUE_NOT_FLAT');return;}
 if(active.length!==1||Number(active[0].positionAmt)!==p.quantity||Math.abs(Number(active[0].entryPrice)-p.entryPrice)>p.entryPrice*1e-6)throw new Error('FET_MIGRATION_POSITION_MISMATCH');
 if(Number(active[0].leverage)!==5||String(active[0].marginType).toLowerCase()!=='cross')throw new Error('FET_MIGRATION_MARGIN_CONTRACT_MISMATCH');
 const o=stopOrders[0];
 if(stopOrders.length!==1||o.clientOrderId!==p.stopClientOrderId||o.type!=='STOP_MARKET'||o.side!=='SELL'||o.reduceOnly!==true||o.status!=='NEW'||Number(o.executedQty)!==0||Number(o.origQty)!==p.quantity||Math.abs(Number(o.stopPrice)-p.hardStop)>p.hardStop*1e-6)throw new Error('FET_MIGRATION_STOP_READBACK_MISMATCH');
}
const arg=(name:string)=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
async function main(){
 const from=String(arg('--from-sha')||''),to=String(arg('--to-sha')||'');
 if(!/^[a-f0-9]{40}$/.test(from)||!/^[a-f0-9]{40}$/.test(to)||from===to)throw new Error('FET_MIGRATION_EXACT_SHA_REQUIRED');
 const path=resolve(arg('--state-path')||'/var/lib/disdex/fet-brk48-residual/state.json');
 const before=await readFetBrk48State(path,from);if(before.pending||before.manualReview)throw new Error('FET_MIGRATION_UNRESOLVED_STATE');
 const client=new AsterV3Client({baseUrl:process.env.ASTER_FUTURES_BASE_URL,userAddress:process.env.ASTER_USER_ADDRESS,privateKey:process.env.ASTER_API_PRIVATE_KEY as `0x${string}`|undefined,readOnlyRateLimitMaxRetries:0,userAgent:`DisDex-Fet-Migration/${to.slice(0,12)}`});
 if(!client.hasTradingCredentials())throw new Error('FET_MIGRATION_CREDENTIALS_MISSING');
 const [positions,orders]=await Promise.all([client.getPositions('FETUSDT'),client.getOpenOrders('FETUSDT')]);
 assertFetMigrationProof(before,positions as unknown as Record<string,unknown>[],orders as unknown as Record<string,unknown>[]);
 if(process.argv.includes('--verify-only')){console.log(JSON.stringify({status:'FET_MIGRATION_PREFLIGHT_PASS',position:before.position||null,ordersSent:0,cancelsSent:0}));return;}
 for(const sha of [from,to]){const r=spawnSync('systemctl',['show',`disdex-fet-brk48@${sha}.service`,'-p','MainPID','--value'],{encoding:'utf8'});if(r.status!==0||r.stdout.trim()!=='0')throw new Error('FET_MIGRATION_RUNNER_MUST_BE_STOPPED');}
 if((await readFile('/home/deploy/disdex-trading/current/.disdex-release-sha','utf8')).trim()!==to)throw new Error('FET_MIGRATION_CURRENT_SHA_MISMATCH');
 if(!before.position){console.log(JSON.stringify(await migrateFlatRuntimeState({strategy:'FET',statePath:path,fromSha:from,toSha:to})));return;}
 const backup=`${path}.before-${to}`;try{await stat(backup);throw new Error('FET_MIGRATION_BACKUP_ALREADY_EXISTS');}catch(e:any){if(e.code!=='ENOENT')throw e;}
 const bytes=await readFile(path),metadata=await stat(path);await copyFile(path,backup);if(!(await readFile(backup)).equals(bytes))throw new Error('FET_MIGRATION_BACKUP_MISMATCH');
 const after={...before,runtimeCommitSha:to};await writeFetBrk48State(path,after);await chown(path,metadata.uid,metadata.gid);await chmod(path,metadata.mode&0o777);
 const readback=await readFetBrk48State(path,to);if(JSON.stringify(readback.position)!==JSON.stringify(before.position)||readback.cooldownUntilTs!==before.cooldownUntilTs)throw new Error('FET_MIGRATION_POSITION_OR_COOLDOWN_CHANGED');
 console.log(JSON.stringify({status:'FET_ACTIVE_STATE_SHA_MIGRATE_PASS',fromSha:from,toSha:to,backupPath:backup,position:readback.position,ordersSent:0,cancelsSent:0,positionChangesSent:0}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(JSON.stringify({status:'FET_MIGRATION_FAIL_CLOSED',message:e.message,ordersSent:0,cancelsSent:0}));process.exitCode=1;});
