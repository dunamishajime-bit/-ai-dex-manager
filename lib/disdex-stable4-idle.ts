import { DISDEX_STABLE4_OPPORTUNITY, type DisDexStable4Mode } from "../config/disdexStable4Opportunity";

export function stable4IdleTaoRiskOffUntil(mode:DisDexStable4Mode, decisionTs:number, taoRawCandidate:boolean, currentUntil=0){
  if(mode==="OFF"||!taoRawCandidate)return currentUntil;
  return Math.max(currentUntil,decisionTs+DISDEX_STABLE4_OPPORTUNITY.idle.taoRiskOffHours*3_600_000);
}
export function stable4IdleBlocks(mode:DisDexStable4Mode, symbol:string, decisionTs:number, riskOffUntil:number, features?:{rel24:number;volumeRatio:number}){
  if(mode!=="LIVE")return false;
  if(DISDEX_STABLE4_OPPORTUNITY.idle.renderWait&&symbol==="RENDERUSDT")return true;
  if(symbol==="JUPUSDT"){
    const p=DISDEX_STABLE4_OPPORTUNITY.idle;
    if(!features||!Number.isFinite(features.rel24)||!Number.isFinite(features.volumeRatio)||features.rel24<p.jupRel24Min||features.volumeRatio<p.jupVolumeRatioMin)return true;
  }
  return decisionTs<riskOffUntil;
}
