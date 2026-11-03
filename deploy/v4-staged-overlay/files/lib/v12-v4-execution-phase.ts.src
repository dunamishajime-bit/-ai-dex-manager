/** An explicit read-only phase, separate from every trading approval. */
type Environment=Readonly<Record<string,string|undefined>>;
export type V4MonitorIdentity={runnerId:'V12_V4'|'V12_V4_MONITOR';serviceUnit:string;
 healthPath:string;healthSchema:string};

export function v4ExecutionPhase(argv:readonly string[],env:Environment):'MONITOR_ONLY'|'PRODUCTION'{
 if(env.V12_V4_ORDERS_ENABLED!==undefined&&!['true','false'].includes(env.V12_V4_ORDERS_ENABLED)){
  throw Error('V4_EXPLICIT_ORDER_PERMISSION_INVALID');
 }
 const requested=argv.includes('--monitor-only');
 const mode=env.V12_V4_OPERATION_MODE?.trim().toUpperCase();
 if(requested||mode==='MONITOR_ONLY'||env.V12_V4_ORDERS_ENABLED==='false'){
  if(!requested||mode!=='MONITOR_ONLY'||env.V12_V4_ORDERS_ENABLED!=='false'
    ||argv.length!==2||argv.filter(v=>v==='--monitor-only').length!==1
    ||argv.filter(v=>v==='--once'||v==='--daemon').length!==1){
   throw Error('V4_MONITOR_PHASE_EXPLICIT_NO_ORDER_CONTRACT_REQUIRED');
  }
  return 'MONITOR_ONLY';
 }
 return 'PRODUCTION';
}

export function v4MonitorIdentity(sha:string,production:boolean,env:Environment):V4MonitorIdentity{
 if(!/^[a-f0-9]{40}$/.test(sha))throw Error('V4_MONITOR_PHASE_SHA_INVALID');
 if(production){
  if(env.V12_V4_OPERATION_MODE!=='MONITOR_ONLY'||env.V12_V4_ORDERS_ENABLED!=='false'){
   throw Error('V4_MONITOR_PHASE_EXPLICIT_NO_ORDER_CONTRACT_REQUIRED');
  }
  const unit=`disdex-v12-v4@${sha}.service`;
  if(env.V12_V4_SERVICE_UNIT!==undefined&&env.V12_V4_SERVICE_UNIT!==unit){
   throw Error('V4_MONITOR_PHASE_SERVICE_MISMATCH');
  }
  if(env.V12_V4_HEALTH_STATE_PATH!==undefined&&env.V12_V4_HEALTH_STATE_PATH!=='/var/lib/disdex/v12-v4/heartbeat.json'){
   throw Error('V4_MONITOR_PHASE_HEALTH_PATH_MISMATCH');
  }
  return {runnerId:'V12_V4',serviceUnit:unit,healthPath:'/var/lib/disdex/v12-v4/heartbeat.json',
   healthSchema:'disdex-v12-v4-runner-heartbeat/v1'};
 }
 const healthPath=env.V12_V4_MONITOR_HEALTH_STATE_PATH||'/var/lib/disdex/v12-v4/monitor/heartbeat.json';
 if(!healthPath.startsWith('/var/lib/disdex/v12-v4/monitor/')||healthPath.split('/').includes('..')){
  throw Error('V4_MONITOR_HEALTH_PATH_INVALID');
 }
 return {runnerId:'V12_V4_MONITOR',serviceUnit:`disdex-v12-v4-monitor@${sha}.service`,healthPath,
  healthSchema:'disdex-v12-v4-monitor-heartbeat/v1'};
}
