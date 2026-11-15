import { DISDEX_STABLE4_OPPORTUNITY, type DisDexStable4Mode } from "../config/disdexStable4Opportunity";
export function stable4PenguShortV20Pass(mode:DisDexStable4Mode,features:{btcReturn24h:number;penguReturn72h:number}){
 if(mode!=="LIVE")return true;
 const p=DISDEX_STABLE4_OPPORTUNITY.pengu;
 return Number.isFinite(features.btcReturn24h)&&Number.isFinite(features.penguReturn72h)&&features.btcReturn24h<=p.shortV20Btc24hMax&&features.penguReturn72h<=p.shortV20Pengu72hMax;
}
export function stable4PenguRecoveryV8Pass(mode:DisDexStable4Mode,features:{btcReturn24h:number}){
 if(mode!=="LIVE")return true;
 return Number.isFinite(features.btcReturn24h)&&features.btcReturn24h<=DISDEX_STABLE4_OPPORTUNITY.pengu.recoveryV8Btc24hMax;
}
