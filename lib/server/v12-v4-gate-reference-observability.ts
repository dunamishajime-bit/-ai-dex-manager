import { lstat, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import type { V12V4HpSnapshot } from "@/lib/v12-v4-hp-contract";
import type { V4VerifiedGateTelemetry } from "@/lib/v12-v4-gate-score";
import { verifyV4GateTelemetry } from "@/lib/v12-v4-gate-telemetry-verify";

/** Fixed, non-symlinked, size-bounded local observer files only. No exchange API calls. */
const ROOT="/var/lib/disdex/v12-v4/";
async function readObserverJson(name:"gate-telemetry.json"|"realtime-decision.json"):Promise<unknown>{
 const path=ROOT+name;
 const st=await lstat(path);
 if(!st.isFile()||st.isSymbolicLink()||st.size<=0||st.size>400000)throw Error("V4_OBSERVER_FILE_UNSAFE");
 if(resolve(await realpath(path))!==resolve(path))throw Error("V4_OBSERVER_SYMLINK");
 const flags=process.platform==="win32"?constants.O_RDONLY:constants.O_RDONLY|(constants.O_NOFOLLOW??0);
 const handle=await open(path,flags);
 try{const after=await handle.stat();if(!after.isFile()||after.size>400000||after.size<=0)throw Error("V4_OBSERVER_FILE_CHANGED");
  return JSON.parse(await handle.readFile({encoding:"utf8"})) as unknown;
 }finally{await handle.close();}
}
export async function loadVerifiedV4GateTelemetry(
 live:V12V4HpSnapshot,now=Date.now(),
):Promise<V4VerifiedGateTelemetry|null>{
 if(live.displayStatus!=="LIVE_VERIFIED"||!live.freshness.heartbeat)return null;
 try{
  const [gates,decision]=await Promise.all([
   readObserverJson("gate-telemetry.json"),readObserverJson("realtime-decision.json"),
  ]);
  return verifyV4GateTelemetry(gates,decision,live,now);
 }catch{return null;}
}
