/** Pure binding check. Root metadata, acknowledgement and time are checked by
 * the common gate; this never emits or modifies an approval. */
export const CANONICAL_V4_PIN_IDS=Object.freeze(['V12_V4','PENGU_V8','QUALITY102_CAUSAL_V1','V52','FET_BRK48_RESIDUAL','HYPE_TREND_LONG','IDLE_PRIORITY_SHORT','SHARED_CRYPTO_RISK','MARGIN_GUARD']);
export const CANONICAL_OPERATOR_TARGET='DD1296_FINAL_ALLIN_10BPS';
export function validateV4CanonicalBinding({artifact:a,manifest:m,readiness:r,sha}){
 const no=reason=>({allowed:false,reason:'OPERATOR_V4_CANONICAL_'+reason});
 const keys=o=>Object.keys(o??{}).sort().join('|');
 if(!/^[a-f0-9]{40}$/.test(sha)||m?.schema!=='disdex-runner-pin-manifest/v1'||m.target!=='professional-dismanager.net'
  ||keys(m.runners)!==[...CANONICAL_V4_PIN_IDS].sort().join('|'))return no('PIN_INVENTORY');
 if(r?.target!=='V12_V4_V2_M150_D05_CORE_NATIVE'||r.implementationStatus!=='READY'
  ||!Array.isArray(r.blockers)||r.blockers.some(x=>x!=='OPERATOR_LIVE_ACTIVATION_REQUIRED'))return no('STRATEGY_POLICY');
 if(a?.approvedSha!==sha||m.runners.V12_V4.sha!==sha||a.target!==CANONICAL_OPERATOR_TARGET
  ||a.ordersEnabled!==true||a.activationClass!=='FULL_LIVE'||JSON.stringify(a.approvedRunners)!=='["V12_V4"]')return no('SCOPE_OR_TARGET');
 if(!((a.route==='CODEX_SSH'&&a.authorizationMethod==='ROOT_SSH_SESSION')
  ||(a.route==='GITHUB_ACTIONS'&&a.authorizationMethod==='OWNER_SIGNED_TOKEN')))return no('AUTHORIZATION_METHOD');
 if(keys(a.approvedShaByRunner)!==keys(m.runners)||CANONICAL_V4_PIN_IDS.some(id=>
  !/^[a-f0-9]{40}$/.test(m.runners[id]?.sha)||a.approvedShaByRunner[id]!==m.runners[id].sha))return no('EXACT_RUNNER_SHA_MAP');
 return {allowed:true,target:CANONICAL_OPERATOR_TARGET,requiredRunners:[...CANONICAL_V4_PIN_IDS]};
}
