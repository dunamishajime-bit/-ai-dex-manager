"""Read-only Aster witness for the HYPE cutover's final XRP protection check."""

POST_CHECK = r"""
import { AsterV3Client } from './lib/aster-v3-client.ts';
import { FileAccountOrderLock } from './lib/disdex-account-order-lock.ts';
import { setTimeout as wait } from 'node:timers/promises';

const shared = '/var/lib/disdex/shared/';
const lock = new FileAccountOrderLock(shared+'account-order.lock',120000,shared+'pending-exposure.json');
let lease;
for(let attempt=0;attempt<6;attempt++){
 lease=await lock.acquire('HYPE_SHA_RESTORE_POST_READ');
 if(lease)break;
 if(attempt<5)await wait(1500+Math.floor(Math.random()*1000));
}
if(!lease)throw Error('HYPE_POST_ACCOUNT_LOCK_BUSY');
try{
 const client=new AsterV3Client({
  baseUrl:process.env.ASTER_FUTURES_BASE_URL,userAddress:process.env.ASTER_USER_ADDRESS,
  privateKey:process.env.ASTER_API_PRIVATE_KEY,readOnlyRateLimitMaxRetries:0,requestTimeoutMs:12000,
  fetchImpl:(input,init={})=>{
   const u=new URL(typeof input==='string'?input:input.url??String(input));
   if((init.method??'GET')!=='GET'||init.body!=null||u.origin!=='https://fapi.asterdex.com'
    ||u.username||u.password||u.hash||!['/fapi/v3/time','/fapi/v3/positionRisk','/fapi/v3/openOrders'].includes(u.pathname))
     throw Error('HYPE_POST_READONLY_BOUNDARY');
   return fetch(input,{...init,redirect:'error'});
  }});
 if(!client.hasTradingCredentials())throw Error('HYPE_POST_CREDENTIALS_REQUIRED');
 await lease.document();
 const [clock,positions,orders]=await Promise.all([client.getServerTime(),client.getPositions(),client.getOpenOrders()]);
 const xrp=positions.filter(p=>p.symbol==='XRPUSDT'&&Number(p.positionAmt)!==0);
 const protection=orders.filter(o=>o.symbol==='XRPUSDT');
 if(Math.abs(Date.now()-Number(clock.serverTime))>=45000||!Number.isFinite(Number(clock.serverTime))
  ||xrp.length!==1||Number(xrp[0].positionAmt)!==-13.3||protection.length!==1)
   throw Error('HYPE_POST_XRP_POSITION_OR_ORDER_CHANGED');
 const [stop]=protection;
 if(stop.clientOrderId!==process.argv[1]||stop.side!=='BUY'||stop.type!=='STOP_MARKET'||stop.status!=='NEW'
  ||!(stop.reduceOnly===true||stop.reduceOnly==='true')||Number(stop.origQty)!==13.3||Number(stop.executedQty)!==0)
   throw Error('HYPE_POST_XRP_STOP_CHANGED');
 await lease.document();
 console.log(JSON.stringify({xrpProtectionVerified:true,signedPostflightAt:Number(clock.serverTime)}));
}finally{await lease.release();}
"""
