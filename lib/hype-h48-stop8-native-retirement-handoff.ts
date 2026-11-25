/**
 * Actual H48 STOP8 post-FLAT retirement handoff for the FUTURE native
 * source-pinned Runner; it is not currently installed/authorized on VPS.
 * H48 TIME48 SELL is already fully reconciled before this is called.
 *
 * Only the exact existing single STOP8 + exact Root approval can cause one
 * DELETE; durable CANCEL_SUBMITTED is mandatory before POST. UNKNOWN can
 * be reconciled only with independent signed GET, without reDELETE.
 */
import {createHash} from "node:crypto";
import {join} from "node:path";
import type {AsterV3Client} from "./aster-v3-client";
import type {AccountLockHandle} from "./disdex-account-order-lock";
import type {H48SignedVenueSnapshot} from "./hype-h48-execution-journal";
import type {H48Stop8OwnerAuthority} from "./hype-h48-resident-stop8";
import {FileH48Stop8Store} from "./hype-h48-stop8-journal-store";
import {
  H48Stop8RetirementCoordinator,
} from "./hype-h48-stop8-retirement";
import {FileH48Stop8RetirementStore} from "./hype-h48-stop8-retirement-store";
import type {H48Stop8ExitRetirement} from "./hype-h48-native-order-executor";

const STOP_ROOT="/var/lib/disdex/hype-h48/stop8" as const;
const RETIRE_ROOT="/var/lib/disdex/hype-h48/stop8-retirement" as const;
const fail=(reason:string):never=>{throw Error("H48_NATIVE_RETIRE_STOP_BLOCKED:"+reason)};
function safeIdentity(sourceSha:string,planSha256:string,positionId:string){
  if(!/^[a-f0-9]{40}$/.test(sourceSha)||!/^[a-f0-9]{64}$/.test(planSha256)
    ||!/^H48\|HYPEUSDT\|[0-9]{12,15}$/.test(positionId))
    fail("SOURCE_OR_POSITION_IDENTITY");
  return createHash("sha256").update(encodeURIComponent(positionId))
    .digest("hex").slice(0,40)+".json";
}
export class H48Stop8NativeRetirementHandoff implements H48Stop8ExitRetirement {
  constructor(private readonly d:{
    client:Pick<AsterV3Client,"cancelOrder">;
    root:H48Stop8OwnerAuthority;
    readSignedVenue:()=>Promise<H48SignedVenueSnapshot>;
    stopRoot?:string;retirementRoot?:string;
    now?:()=>number;
  }){}
  private coordinator(input:{
    sourceSha:string;planSha256:string;positionId:string;
    lease:AccountLockHandle;now:number;
  }){
    const filename=safeIdentity(input.sourceSha,input.planSha256,input.positionId);
    const stop=new FileH48Stop8Store(
      join(this.d.stopRoot??STOP_ROOT,input.sourceSha,filename),
      input.sourceSha,input.planSha256);
    const retirement=new FileH48Stop8RetirementStore(
      join(this.d.retirementRoot??RETIRE_ROOT,input.sourceSha,filename),
      input.sourceSha,input.planSha256);
    return new H48Stop8RetirementCoordinator({
      sourceSha:input.sourceSha,planSha256:input.planSha256,
      stopJournal:stop,retireStore:retirement,lease:input.lease,
      ownerAuthority:this.d.root,
      readSignedVenue:this.d.readSignedVenue,
      venue:this.d.client,now:this.d.now,
    });
  }
  async retireAfterSignedFlat(input:{
    sourceSha:string;planSha256:string;positionId:string;
    lease:AccountLockHandle;now:number;
  }):Promise<{status:"STOP8_RETIRED_SIGNED_FLAT";stopCancels:0|1}>{
    const result=await this.coordinator(input).retireOnce();
    if(result.status!=="STOP8_RETIRED_SIGNED_FLAT")
      fail("CANCEL_UNKNOWN_SIGNED_RECOVERY_REQUIRED");
    return result;
  }
  async reconcileSubmittedWithoutResend(input:{
    sourceSha:string;planSha256:string;positionId:string;
    lease:AccountLockHandle;now:number;
  }):Promise<Readonly<{status:"STOP8_RETIRED_SIGNED_FLAT"|"STOP8_CANCEL_UNKNOWN_REVIEW";stopCancels:0}>>{
    return this.coordinator(input).inspectUnknownWithoutResend();
  }
}
