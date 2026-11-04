import {writeRunnerTickHeartbeat} from './disdex-runner-tick-heartbeat';
import {runnerMutationTelemetry} from './disdex-runner-mutation-telemetry';

const SERVICES = Object.freeze({
  PENGU_V8: 'disdex-pengu-dual-ls-v2',
  QUALITY102_CAUSAL_V1: 'disdex-quality102-causal-v1',
  FET_BRK48_RESIDUAL: 'disdex-fet-brk48',
  HYPE_TREND_LONG: 'disdex-hype-long',
  IDLE_PRIORITY_SHORT: 'disdex-idle-priority-short',
});

/** A completion observation, never a supervisor beat or new order authority. */
export async function observePeerDecisionCycle<T extends {status:string;message?:string}>(input:{
  runnerId:keyof typeof SERVICES;runtimeSha:string;mode:string;root?:string;operation:()=>Promise<T>;
}):Promise<T> {
  if (!['LIVE','SHADOW','PAPER'].includes(input.mode)) throw Error('PEER_TICK_MODE_INVALID');
  if (input.mode !== 'LIVE') return input.operation();
  if (!Object.hasOwn(SERVICES,input.runnerId) || !/^[a-f0-9]{40}$/i.test(input.runtimeSha)) throw Error('PEER_TICK_IDENTITY_INVALID');
  const sha=input.runtimeSha.toLowerCase();
  for(const expected of [process.env.DISDEX_RELEASE_SHA,process.env.DISDEX_RUNTIME_COMMIT_SHA]) {
    if(expected && expected.toLowerCase()!==sha) throw Error('PEER_TICK_ENVIRONMENT_SHA_MISMATCH');
  }
  const tickStartedAt=Date.now();
  const result=await input.operation();
  const tickCompletedAt=Date.now();
  if(!result || typeof result.status!=='string' || !result.status.trim()) throw Error('PEER_TICK_RESULT_INVALID');
  const telemetry=runnerMutationTelemetry(result);
  const counters=Object.fromEntries(Object.entries(telemetry).filter(([key,value])=>key!=='mutationCountersKnown'&&value!==null));
  await writeRunnerTickHeartbeat({root:input.root,runnerId:input.runnerId,runtimeSha:sha,
    serviceUnit:`${SERVICES[input.runnerId]}@${sha}.service`,tickStartedAt,tickCompletedAt,
    status:result.status,reason:typeof result.message==='string'?result.message:'',
    newOrdersAllowed:false,...counters});
  // Legacy result types do not attest admission. The root activation/gates remain
  // authoritative; do not manufacture permission or mutation counts from status.
  return result;
}
