import "dotenv/config";
import { writeFile, mkdir, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor } from "../lib/direct-trade-executor";
import { buildFetBrk48Signal, normalizeFetH1 } from "../lib/fet-brk48-signal";
import { FET_BRK48_RESIDUAL } from "../config/fetBrk48Runtime";
import { INTEGRATED_PRODUCTION_RISK_POLICY } from "../config/integratedProductionRiskPolicy";
import { classifyAsterSymbol } from "../lib/disdex-aster-portfolio-classifier";
import { readQuality102CausalV1Ownership, quality102OwnsPosition } from "../lib/disdex-quality102-causal-v1-ownership";
import { createInterruptibleDelay } from "../lib/interruptible-delay";

function num(v:unknown,f=0){const n=Number(v); return Number.isFinite(n)?n:f;}
async function atomic(path:string,value:unknown){const target=resolve(path);await mkdir(dirname(target),{recursive:true});const tmp=`${target}.${process.pid}.${Date.now()}.tmp`;await writeFile(tmp,`${JSON.stringify(value,null,2)}\n`,{encoding:"utf8",mode:0o600});await rename(tmp,target);}
export async function fetBrk48ShadowSnapshot(now=Date.now()){
  const client=new AsterV3Client({baseUrl:process.env.ASTER_FUTURES_BASE_URL,userAddress:process.env.ASTER_USER_ADDRESS,privateKey:process.env.ASTER_API_PRIVATE_KEY as `0x${string}`|undefined});
  const executor=new AsterDirectTradeExecutor(client);
  const [klines,account,positions,q102]=await Promise.all([
    client.getKlines(FET_BRK48_RESIDUAL.symbol,"1h",120),
    executor.getAccountSnapshot(),
    executor.getPositions(),
    readQuality102CausalV1Ownership({expectedRuntimeSha:process.env.DISDEX_Q102_RUNTIME_SHA||process.env.DISDEX_RUNTIME_COMMIT_SHA}),
  ]);
  const signal=buildFetBrk48Signal(normalizeFetH1(klines,now),now);
  const nonzero=positions.filter(p=>Math.abs(p.quantity)>1e-12);
  const equity=account.walletBalance+nonzero.reduce((s,p)=>s+num(p.unrealizedPnl),0);
  if(!(equity>0)) throw new Error("FET_SHADOW_EQUITY_INVALID");
  let cryptoNotional=0, stockNotional=0, unknown:string[]=[];
  for(const p of nonzero){
    if(quality102OwnsPosition(q102,p)){cryptoNotional+=Math.abs(p.quantity)*p.markPrice;continue;}
    const c=classifyAsterSymbol(p.symbol);
    if(c.assetClass==="CRYPTO") cryptoNotional+=Math.abs(p.quantity)*p.markPrice;
    else if(c.assetClass==="STOCK") stockNotional+=Math.abs(p.quantity)*p.markPrice;
    else unknown.push(p.symbol);
  }
  const cryptoGross=cryptoNotional/equity, stockGross=stockNotional/equity, totalGross=(cryptoNotional+stockNotional)/equity;
  const residual=Math.max(0,Math.min(FET_BRK48_RESIDUAL.maximumGross,INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap-cryptoGross,INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap-totalGross));
  const q102FetOwned=nonzero.some(p=>p.symbol.toUpperCase()==="FETUSDT"&&quality102OwnsPosition(q102,p));
  const eligible=Boolean(signal)&&unknown.length===0&&!q102FetOwned&&residual+1e-12>=FET_BRK48_RESIDUAL.minimumResidualGross;
  return {schema:"fet-brk48-shadow/v1",updatedAt:now,strategyId:FET_BRK48_RESIDUAL.strategyId,mode:"SHADOW",ordersSent:0,cancelSent:0,positionChangesSent:0,signal:signal||null,portfolio:{equity,cryptoGross,stockGross,totalGross,residualGross:residual,cryptoCap:INTEGRATED_PRODUCTION_RISK_POLICY.cryptoGrossCap,totalCap:INTEGRATED_PRODUCTION_RISK_POLICY.totalGrossCap},ownership:{q102FetOwned,unknown},eligible,blockReason:!signal?"NO_SIGNAL":unknown.length?"UNKNOWN_POSITION":q102FetOwned?"Q102_OWNS_FET":residual<FET_BRK48_RESIDUAL.minimumResidualGross?"RESIDUAL_BELOW_0P05":""};
}
async function main(){
  const daemon=process.argv.includes("--daemon"); const path=process.env.FET_BRK48_SHADOW_STATE_PATH||".runtime-state/fet-brk48-residual/shadow.json"; const delay=createInterruptibleDelay(); let stop=false; const shutdown=()=>{stop=true;delay.interrupt();}; process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
  do{const snap=await fetBrk48ShadowSnapshot();await atomic(path,snap);console.log(JSON.stringify(snap));if(!daemon||stop)break;await delay.wait(30_000);}while(!stop);
}
main().catch(e=>{console.error(JSON.stringify({level:"fatal",strategyId:FET_BRK48_RESIDUAL.strategyId,mode:"SHADOW",message:e instanceof Error?e.message:String(e),ordersSent:0}));process.exitCode=1;});
