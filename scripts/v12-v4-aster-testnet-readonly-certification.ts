/**
 * Aster V3 TESTNET-only GET-only signed account preflight.
 * Does not mutate exchange positions, orders, or runner configuration.
 * Credentials are supplied by the local operator environment and are
 * never logged or transmitted outside the official TESTNET host.
 */
import { AsterApiError, AsterV3Client } from "../lib/aster-v3-client";
const ENDPOINT = "https://fapi.asterdex-testnet.com";
export function assertV4TestnetEndpoint(input:string):string {
 const raw=input.trim();
 if(raw!==ENDPOINT)throw Error("V4_TESTNET_BASE_URL_MUST_MATCH_OFFICIAL_HOST");
 return raw;
}
function requiredEnv(name:string):string {
 const val=process.env[name];
 if(!val||!val.trim())throw Error("V4_TESTNET_MISSING_"+name);
 return val.trim();
}
function validateAddress(label:string,address:string){
 if(!/^0x[0-9a-fA-F]{40}$/.test(address))throw Error("V4_TESTNET_"+label+"_INVALID");
}
export async function runV4TestnetReadOnly(){
 assertV4TestnetEndpoint(process.env.ASTER_TESTNET_BASE_URL || ENDPOINT);
 const master=requiredEnv("ASTER_TESTNET_USER_ADDRESS");
 const signer=requiredEnv("ASTER_TESTNET_SIGNER_ADDRESS");
 validateAddress("USER",master);
 validateAddress("SIGNER",signer);
 if(master.toLowerCase()===signer.toLowerCase())
  throw Error("V4_TESTNET_MAIN_AND_AGENT_MUST_BE_DISTINCT");
 const privateKey=requiredEnv("ASTER_TESTNET_API_PRIVATE_KEY");
 if(!/^(0x)?[a-fA-F0-9]{64}$/.test(privateKey))
  throw Error("V4_TESTNET_AGENT_SECRET_FORMAT_INVALID");
 const client=new AsterV3Client({baseUrl:ENDPOINT,
  userAddress:master,privateKey:privateKey as any,
  requestTimeoutMs:12000,readOnlyRateLimitMaxRetries:0,
  userAgent:"DisDex-V4-Testnet-ReadOnly-Certification/1.0"});
 if(client.signerAddress?.toLowerCase()!==signer.toLowerCase())
  throw Error("V4_TESTNET_SIGNER_KEY_ADDRESS_MISMATCH");
 const mode=await client.getPositionMode();
 if(typeof mode.dualSidePosition!=="boolean")
  throw Error("V4_TESTNET_POSITION_MODE_READBACK_INVALID");
 const balances=await client.getBalances();
 if(!Array.isArray(balances))throw Error("V4_TESTNET_BALANCE_READBACK_INVALID");
 const positions=await client.getPositions();
 if(!Array.isArray(positions))throw Error("V4_TESTNET_POSITIONS_READBACK_INVALID");
 const ethOrders=await client.getOpenOrders("ETHUSDT");
 if(!Array.isArray(ethOrders))throw Error("V4_TESTNET_OPEN_ORDERS_READBACK_INVALID");
 const usdt=balances.find(b=>b.asset==="USDT");
 const cash=Number(usdt?.availableBalance??0);
 const hasCash=Number.isFinite(cash)&&cash>0;
 console.log(JSON.stringify({
  status:mode.dualSidePosition?"BLOCKED_HEDGE_MODE":
   hasCash?"TESTNET_SIGNED_READBACK_OK":"BLOCKED_NO_TESTNET_USDT",
  environment:"ASTER_FUTURES_V3_TESTNET_ONLY",
  signedReadback:true,positionMode:mode.dualSidePosition?"HEDGE":"ONE_WAY",
  positiveTestnetUsdtAvailable:hasCash,
  liveTestnetPositions:positions.filter(x=>Math.abs(Number(x.positionAmt))>1e-12).length,
  ethOpenOrderCount:ethOrders.length,
  mutationCalls:0,certifiedStopExitRace:false,canActivateProduction:false
 }));
}
if(process.argv[1]&&process.argv[1].includes("v12-v4-aster-testnet-readonly-certification"))
 runV4TestnetReadOnly().catch(e=>{
  const kind=e instanceof AsterApiError?
   ("V4_TESTNET_VENUE_ERROR_HTTP_"+e.status+"_CODE_"+String(e.code??"NONE")):
   e instanceof Error&&e.message.startsWith("V4_TESTNET_")?e.message:
   "V4_TESTNET_READBACK_FAILED_CLOSED";
  console.error(JSON.stringify({status:"BLOCKED",reason:kind,secretDisclosed:false,mutationCalls:0}));
  process.exitCode=2;
 });
