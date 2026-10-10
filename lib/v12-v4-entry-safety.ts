import {readFile} from "node:fs/promises";
import {assertSharedKillSwitchAllowsNewEntry} from "./disdex-shared-kill-switch";
import {readSharedCryptoDailyRisk} from "./disdex-shared-crypto-daily-risk";

export const V4_SHARED_DAILY_RISK_PATH="/var/lib/disdex/shared/crypto-daily-risk.json";
export const V4_MARGIN_GUARD_PATH="/var/lib/disdex/shared/margin-risk/guard-live.json";

export async function assertV4EntrySafety(input:{
 now?:number;env?:NodeJS.ProcessEnv;dailyRiskPath?:string;marginPath?:string;
 dailyRiskMaxAgeMs?:number;marginMaxAgeMs?:number;
}={}){
 const now=input.now??Date.now();
 await assertSharedKillSwitchAllowsNewEntry(input.env??process.env);
 const daily=await readSharedCryptoDailyRisk(
  input.dailyRiskPath??V4_SHARED_DAILY_RISK_PATH,now,input.dailyRiskMaxAgeMs??120000);
 if(!daily.ok)throw Error("V4_SHARED_DAILY_RISK_BLOCK:"+String(daily.reason??"UNKNOWN"));
 let margin:any;
 try{margin=JSON.parse(await readFile(input.marginPath??V4_MARGIN_GUARD_PATH,"utf8"));}
 catch{throw Error("V4_MARGIN_GUARD_UNAVAILABLE");}
 const checked=Number(margin?.checkedAt??margin?.updatedAt);
 if(margin?.stage!=="HEALTHY"||margin?.ordersAllowed!==true||
   !Number.isFinite(checked)||checked<=0||checked>now||
   now-checked>(input.marginMaxAgeMs??360000))
  throw Error("V4_MARGIN_GUARD_BLOCK");
 return {dailyRiskUpdatedAt:Number(daily.state?.updatedAt),marginCheckedAt:checked};
}
