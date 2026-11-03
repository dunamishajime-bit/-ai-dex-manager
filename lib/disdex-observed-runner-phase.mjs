import { readFile, lstat } from 'node:fs/promises';

const invalid = (reason) => ({valid:false,lastTickAt:null,reason});
export function validateObservedTick(runner,service,marker,now) {
 if(!marker || marker.schema!=='disdex-runner-tick/v1')return invalid('OBSERVED_TICK_SCHEMA');
 const expected={runnerId:runner.runnerId,runtimeSha:runner.expectedSha,expectedSha:runner.expectedSha,serviceUnit:runner.unit,mainPid:service?.pid,workingDirectory:runner.releaseRoot};
 if(!/^[a-f0-9]{40}$/.test(runner.expectedSha)||!Number.isSafeInteger(service?.pid)||service.pid<=0||service.cwd!==runner.releaseRoot||Object.entries(expected).some(([k,v])=>marker[k]!==v))return invalid('OBSERVED_TICK_IDENTITY');
 const start=marker.tickStartedAt,end=marker.tickCompletedAt;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<=0||end<start||end>now||now-end>runner.maxStateAgeMs)return invalid('OBSERVED_TICK_TIME');
 if(typeof marker.status!=='string'||!marker.status||typeof marker.reason!=='string'||typeof marker.newOrdersAllowed!=='boolean')return invalid('OBSERVED_TICK_RESULT');
 for(const key of ['ordersSent','cancelsSent','positionChangesSent'])if(key in marker&&(!Number.isSafeInteger(marker[key])||marker[key]<0))return invalid('OBSERVED_TICK_COUNTER');
 return {valid:true,lastTickAt:end,startedAt:start,status:marker.status,reason:marker.reason,marker};
}

export function observedV4Phase(runner,service,state,tick) {
 const mode=String(state?.operationMode||'').toUpperCase();
 if(mode!=='MONITOR_ONLY')return {mode,monitorOnly:false,valid:['CANARY','CERTIFIED'].includes(mode)};
 const valid=state?.schema==='disdex-v12-v4-runner-heartbeat/v1'&&state.strategyId==='V12_V4'
  &&state.mode==='MONITOR_ONLY'&&state.liveEnabled===false&&state.newOrdersAllowed===false
  &&state.runtimeSha===runner.expectedSha&&state.mainPid===service?.pid&&state.workingDirectory===runner.releaseRoot
  &&tick?.valid===true&&state.lastTickAt===tick.lastTickAt
  &&tick.marker.newOrdersAllowed===false&&['ordersSent','cancelsSent','positionChangesSent'].every(k=>tick.marker[k]===0);
 return {mode,monitorOnly:true,valid,newOrdersAllowed:false};
}

export async function readObservedRunnerTick(runner,service,now,paths={}) {
 try {
  const path=paths.manifestPath||'/etc/disdex/runner-pins.json';const meta=await lstat(path);
  if(!meta.isFile()||meta.isSymbolicLink()||meta.uid!==0||(meta.mode&0o022))return invalid('OBSERVED_PIN_NOT_TRUSTED');
  const pins=JSON.parse(await readFile(path,'utf8'));const pin=pins?.runners?.[runner.runnerId];
  if(pins.schema!=='disdex-runner-pin-manifest/v1'||pin?.sha!==runner.expectedSha||pin.serviceUnit!==runner.unit||pin.releaseRoot!==runner.releaseRoot)return invalid('OBSERVED_PIN_IDENTITY');
  if(pin.evidenceMode!=='tick-v1')return {valid:false,legacy:true,lastTickAt:null,reason:'LEGACY_STATE_TIMESTAMP_UNVERIFIED'};
  const marker=JSON.parse(await readFile(`${paths.ticksRoot||'/var/lib/disdex/runner-health/ticks'}/${runner.heartbeatFile}`,'utf8'));
  const after=await lstat(path);
  if(meta.ino!==after.ino||meta.dev!==after.dev||meta.mtimeMs!==after.mtimeMs)return invalid('OBSERVED_PIN_CHANGED');
  return validateObservedTick(runner,service,marker,now);
 }catch{return invalid('OBSERVED_TICK_UNAVAILABLE');}
}
