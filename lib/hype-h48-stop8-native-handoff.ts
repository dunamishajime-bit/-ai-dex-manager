/**
 * Candidate bridge from an authenticated H48 entry fill to real ASTER
 * resident STOP8. The Root STOP8 grant verifier is intentionally injected:
 * no existing H48_TIME_ONLY approval can satisfy a new STOP8 live policy.
 * A new H48R4+STOP8 issuer and certified immutable runtime are required.
 */
import {createHash} from "node:crypto";
import {join} from "node:path";
import type {AsterV3Client} from "./aster-v3-client";
import type {AccountLockHandle} from "./disdex-account-order-lock";
import type {H48SignedVenueSnapshot} from "./hype-h48-execution-journal";
import type {H48ResidentStop8Handoff} from "./hype-h48-native-order-executor";
import {makeH48Stop8Intent,H48Stop8Installer,type H48Stop8OwnerAuthority} from "./hype-h48-resident-stop8";
import {FileH48Stop8Store} from "./hype-h48-stop8-journal-store";
const fail=(reason:string):never=>{throw Error("H48_STOP8_HANDOFF_BLOCKED:"+reason)};
const STOP_ROOT="/var/lib/disdex/hype-h48/stop8" as const;
export class H48Stop8NativeHandoff implements H48ResidentStop8Handoff {
  constructor(private readonly dep:{
    client:Pick<AsterV3Client,"getExchangeInfo"|"placeStopMarketOrder">;
    readSignedVenue:()=>Promise<H48SignedVenueSnapshot>;
    stop8RootAuthority:H48Stop8OwnerAuthority;
    explicitStoreRoot?:string;
    now?:()=>number;
  }){}
  async protectConfirmedEntry(input:{
    sourceSha:string;planSha256:string;
    position:{
      contract:{positionId:string;sourceSha:string;logicalEntryTs:number;logicalExitTs:number};
      quantity:number;entryPrice:number;entryClientOrderId:string;observedAt:number;
    };
    lease:AccountLockHandle;now:number;
  }):Promise<{status:"STOP8_VERIFIED";stopClientOrderId:string}>{
    const d=this.dep;
    if(!/^[0-9a-f]{40}$/.test(input.sourceSha)
      ||!/^[0-9a-f]{64}$/.test(input.planSha256)
      ||input.position.contract.sourceSha!==input.sourceSha
      ||!Number.isSafeInteger(input.now)||input.now<=0
      ||!Number.isFinite(input.position.entryPrice)
      ||input.position.entryPrice<=0||!Number.isFinite(input.position.quantity)
      ||input.position.quantity<=0)fail("POSITION_SOURCE_OR_PRICE");
    // Symbol + filter status are authenticated market reference data, not
    // arbitrarily chosen rounding. No order until a real venue tick size is
    // obtained and a real Owner-signed STOP8 grant is checked.
    const info=await d.client.getExchangeInfo();
    const matching=info?.symbols?.filter(row=>row.symbol==="HYPEUSDT");
    if(matching?.length!==1||matching[0].status!=="TRADING"
      ||!matching[0].orderTypes?.includes("STOP_MARKET"))
      fail("HYPE_STOP_MARKET_NOT_AVAILABLE");
    const filters=matching[0].filters?.filter(row=>row.filterType==="PRICE_FILTER");
    const tick=Number(filters?.[0]?.tickSize);
    if(filters?.length!==1||!Number.isFinite(tick)||tick<=0)
      fail("EXCHANGE_PRICE_FILTER_NOT_ATTESTED");
    const id=encodeURIComponent(input.position.contract.positionId);
    const basename=createHash("sha256").update(id).digest("hex").slice(0,40)+".json";
    const path=join(d.explicitStoreRoot??STOP_ROOT,input.sourceSha,basename);
    const store=new FileH48Stop8Store(path,input.sourceSha,input.planSha256);
    // A second attempt must be rejected even before a signed venue read;
    // a STOP may have been submitted before a crash and still be pending.
    try{
      await store.load();
      fail("PRIOR_STOP_INTENT_EXISTS");
    }catch(error){
      if((error as NodeJS.ErrnoException)?.code!=="ENOENT")throw error;
    }
    const observedNow=d.now??Date.now;
    const intent=makeH48Stop8Intent({
      sourceSha:input.sourceSha,planSha256:input.planSha256,
      positionId:input.position.contract.positionId,
      entryClientOrderId:input.position.entryClientOrderId,
      entryPrice:input.position.entryPrice,quantity:input.position.quantity,
      tickSize:tick,now:observedNow(),
    });
    // A PREPARED file must not be created under an unsigned policy. This
    // independent Root check is repeated by the installer after persistence.
    await d.stop8RootAuthority.assertSignedResidentStop8({
      sourceSha:input.sourceSha,planSha256:input.planSha256,
      positionId:input.position.contract.positionId,
      lease:input.lease,now:input.now,
    });
    // Refuse to overwrite an old/stale/ambiguous STOP journal. The absence
    // of a trusted flat/new state is never a reason to retry a prior attempt.
    const signed=await d.readSignedVenue();
    // The entry submission clock predates this signed GET. Validate the
    // snapshot against an observation clock taken AFTER the GET, not the
    // earlier entry clock; never accept a future-dated venue proof.
    const checkedAt=observedNow();
    await store.initialize({
      intent,lease:input.lease,signedVenue:signed,now:checkedAt,
    });
    const installer=new H48Stop8Installer({
      sourceSha:input.sourceSha,planSha256:input.planSha256,
      store,lease:input.lease,authority:d.stop8RootAuthority,
      venue:d.client,readSignedVenue:d.readSignedVenue,
      now:d.now,
    });
    const result=await installer.installOnce();
    if(result.status!=="STOP8_VERIFIED")
      fail("STOP_SUBMITTED_ACCOUNT_RECONCILIATION_REQUIRED");
    return {status:"STOP8_VERIFIED",stopClientOrderId:result.clientOrderId};
  }
}
