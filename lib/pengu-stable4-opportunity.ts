import { DISDEX_STABLE4_OPPORTUNITY, type DisDexStable4Mode } from "../config/disdexStable4Opportunity";
export function stable4PenguShortV20Pass(mode:DisDexStable4Mode,features:{btcReturn24h:number;penguReturn72h:number}){
 if(mode!=="LIVE")return true;
 const p=DISDEX_STABLE4_OPPORTUNITY.pengu;
 return features.btcReturn24h<=p.shortV20Btc24hMax&&features.penguReturn72h<=p.shortV20Pengu72hMax;
}