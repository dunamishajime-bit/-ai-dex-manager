/** Turn a recovery request into observable intent, never into a system action. */
export function applyWatchdogAuditMode(result,auditOnly){
 return auditOnly&&result.action==='RESTART'
  ?{...result,action:'RESTART_REQUIRED_NOT_EXECUTED',watchdogAuditOnly:true}
  :result;
}
