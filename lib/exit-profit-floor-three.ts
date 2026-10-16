/**
 * Phase 1 of three narrowly scoped exit-profit floors.
 *
 * RESEARCH / SHADOW ADAPTER ONLY. This module is deliberately incapable
 * of placing, replacing or cancelling an Aster order. The returned proposal
 * MUST NOT be submitted without certified owner-ledger / venue reconciliation.
 *
 * Source: formal eight-strategy H1 replay 2025-08-10..2026-08-10.
 * In-sample improvement does not establish live efficacy.
 */
export const THREE_EXIT_FLOOR_POLICY_ID =
    "DD1296_Q102_MR_V4_G5_X05_H1_FLOOR_20261016" as const;
export const EXIT_FLOOR_HOUR_MS = 3_600_000;

export type ExitFloorOwner = "Q102" | "V12_V4";
export type ExitFloorSide = "LONG" | "SHORT";
export type ExitFloorRoute = "Q102_MR" | "REC_G5_SLOW_TREND" | "REC_X05_TIME_36H";

export type ExitFloorPolicy = Readonly<{
    policyId: typeof THREE_EXIT_FLOOR_POLICY_ID;
    owner: ExitFloorOwner;
    route: ExitFloorRoute;
    triggerReturn: number;
    securedReturn: number;
}>;

export const THREE_EXIT_FLOOR_POLICIES: readonly ExitFloorPolicy[] = [
    { policyId: THREE_EXIT_FLOOR_POLICY_ID, owner:"Q102", route:"Q102_MR",
      triggerReturn:.03, securedReturn:.01 },
    { policyId: THREE_EXIT_FLOOR_POLICY_ID, owner:"V12_V4", route:"REC_G5_SLOW_TREND",
      triggerReturn:.02, securedReturn:.005 },
    { policyId: THREE_EXIT_FLOOR_POLICY_ID, owner:"V12_V4", route:"REC_X05_TIME_36H",
      triggerReturn:.025, securedReturn:.01 },
] as const;

export type ExitFloorIdentity = Readonly<{
    owner: ExitFloorOwner | string;
    symbol: string;
    side: ExitFloorSide;
    entryTs: number;
    entryPrice: number;
    entryQuantity: number;
    family?: string;
    route?: string;
    legId: string;
}>;

export type ClosedH1ExitBar = Readonly<{
    openTs: number;
    open: number;
    high: number;
    low: number;
    close: number;
}>;

export type ExitFloorH1State = Readonly<{
    policyId: typeof THREE_EXIT_FLOOR_POLICY_ID;
    owner: ExitFloorOwner;
    symbol: string;
    legId: string;
    side: ExitFloorSide;
    entryTs: number;
    entryPrice: number;
    lastClosedH1OpenTs: number;
    highWaterCloseReturn: number;
    armed: boolean;
    securedReturn: number;
    floorStopPrice?: number;
    effectiveFromTs?: number;
}>;

export type ExitFloorTransition = Readonly<{
    kind: "NOT_TARGETED" | "OBSERVING" | "ARMED" | "UNCHANGED" | "BLOCKED";
    state?: ExitFloorH1State;
    reason: string;
    orderEnabled: false;
    ordersSent: 0;
}>;

const valid = (n:number) => Number.isFinite(n) && n>0;
const tolerance = (n:number) => Math.max(1e-12,Math.abs(n)*1e-10);

/** Exact route/family whitelist: PENGU and every other family are excluded. */
export function selectThreeExitFloorPolicy(
    identity: Pick<ExitFloorIdentity,"owner"|"route"|"family">,
): ExitFloorPolicy | undefined {
    if(identity.owner==="Q102" && identity.family==="MR")
        return THREE_EXIT_FLOOR_POLICIES[0];
    if(identity.owner==="V12_V4" && identity.route==="REC_G5_SLOW_TREND")
        return THREE_EXIT_FLOOR_POLICIES[1];
    if(identity.owner==="V12_V4" && identity.route==="REC_X05_TIME_36H")
        return THREE_EXIT_FLOOR_POLICIES[2];
    return undefined;
}

/** A stop below LONG entry is not a profit floor. Likewise a stop above SHORT entry. */
export function threeExitFloorStopPrice(
    identity: Pick<ExitFloorIdentity,"entryPrice"|"side">,
    securedReturn: number,
): number {
    if(!valid(identity.entryPrice) || !(securedReturn>0&&securedReturn<1) ||
        !["LONG","SHORT"].includes(identity.side))throw Error("EXIT_FLOOR_INVALID_POSITION");
    return identity.entryPrice*(1+(identity.side==="LONG"?1:-1)*securedReturn);
}

/**
 * Idempotent and deterministic on duplicate last-bar observations.
 * No same-bar stop; activation is only after H1 is causally completed.
 */
export function observeThreeExitFloorH1(
    identity: ExitFloorIdentity,bar:ClosedH1ExitBar,observedAt:number,
    previous?:ExitFloorH1State,
): ExitFloorTransition {
    const policy=selectThreeExitFloorPolicy(identity);
    const out=(kind:ExitFloorTransition["kind"],reason:string,state?:ExitFloorH1State):ExitFloorTransition=>
        ({kind,reason,...(state?{state}:{}),orderEnabled:false,ordersSent:0});
    if(!policy)return out("NOT_TARGETED","THREE_FLOOR_ROUTE_NOT_TARGETED");
    if(!valid(identity.entryPrice)||!valid(identity.entryQuantity)||!valid(identity.entryTs)||
        !identity.symbol||!identity.legId || !["LONG","SHORT"].includes(identity.side))
        throw Error("EXIT_FLOOR_INVALID_ACTUAL_ENTRY");
    if(!Number.isFinite(observedAt)||bar.openTs%EXIT_FLOOR_HOUR_MS!==0||
        bar.openTs<identity.entryTs||bar.openTs+EXIT_FLOOR_HOUR_MS>observedAt)
        throw Error("EXIT_FLOOR_UNCLOSED_OR_PAST_ENTRY_H1");
    if(![bar.open,bar.high,bar.low,bar.close].every(valid)||
        bar.high<Math.max(bar.open,bar.close)||bar.low>Math.min(bar.open,bar.close)||
        bar.low>bar.high)
        throw Error("EXIT_FLOOR_INVALID_H1_BAR");
    if(previous){
        if(previous.policyId!==THREE_EXIT_FLOOR_POLICY_ID||
            previous.owner!==policy.owner||previous.symbol!==identity.symbol||
            previous.legId!==identity.legId||previous.side!==identity.side||
            previous.entryTs!==identity.entryTs||previous.entryPrice!==identity.entryPrice||
            previous.securedReturn!==policy.securedReturn)
            throw Error("EXIT_FLOOR_RESTART_LINEAGE_MISMATCH");
        if(bar.openTs===previous.lastClosedH1OpenTs)
            return out("UNCHANGED","EXIT_FLOOR_DUPLICATE_H1_NO_MUTATION",previous);
        if(bar.openTs!==previous.lastClosedH1OpenTs+EXIT_FLOOR_HOUR_MS)
            throw Error("EXIT_FLOOR_H1_GAP_OR_REVERSE");
    }
    const favorable=identity.side==="LONG"
        ?bar.close/identity.entryPrice-1:1-bar.close/identity.entryPrice;
    const highWater=Math.max(previous?.highWaterCloseReturn??0,favorable);
    const armed=previous?.armed===true || highWater>=policy.triggerReturn-1e-12;
    const price=armed?threeExitFloorStopPrice(identity,policy.securedReturn):undefined;
    const state:ExitFloorH1State={
        policyId:THREE_EXIT_FLOOR_POLICY_ID,owner:policy.owner,
        symbol:identity.symbol,legId:identity.legId,side:identity.side,
        entryTs:identity.entryTs,entryPrice:identity.entryPrice,
        lastClosedH1OpenTs:bar.openTs,highWaterCloseReturn:highWater,
        armed,securedReturn:policy.securedReturn,
        ...(price===undefined?{}:{floorStopPrice:price,
            effectiveFromTs:previous?.effectiveFromTs??bar.openTs+EXIT_FLOOR_HOUR_MS}),
    };
    return out(!armed?"OBSERVING":previous?.armed?"UNCHANGED":"ARMED",
        armed?"EXIT_FLOOR_H1_CAUSAL_ARMED_OR_RECONFIRMED":"EXIT_FLOOR_H1_BELOW_TRIGGER",
        state);
}

export type ExistingSignedStop = Readonly<{
    symbol:string;side:"BUY"|"SELL";clientOrderId:string;orderId:number;
    type:"STOP_MARKET";status:string;reduceOnly:boolean;
    quantity:number;executedQuantity:number;stopPrice:number;
    capturedAt:number;
}>;
export type SignedFloorPosition = Readonly<{
    symbol:string;side:ExitFloorSide;quantity:number;markPrice:number;capturedAt:number;
}>;
export type FloorReplacementProposal = Readonly<{
    kind:"SHADOW_READY"|"NO_IMPROVEMENT"|"BLOCKED";
    reason:string;
    symbol:string;
    existingClientOrderId?:string;
    newStopPrice?:number;
    quantity?:number;
    policyId:typeof THREE_EXIT_FLOOR_POLICY_ID;
    orderEnabled:false;
    ordersSent:0;
}>;

/**
 * Independently proves candidate price direction and order identity.
 * Cannot send orders or claim the resident STOP has been replaced.
 * Partial fills intentionally block until venue/ledger reconciliation.
 */
export function previewThreeExitFloorReplacement(input:{
    state:ExitFloorH1State;
    signedPosition:SignedFloorPosition;
    signedStop:ExistingSignedStop;
    normalizedRequestedStopPrice:number;
    observedAt:number;
}):FloorReplacementProposal{
    const {state,signedPosition:p,signedStop:o,normalizedRequestedStopPrice:n,observedAt:at}=input;
    const response=(kind:FloorReplacementProposal["kind"],reason:string,price?:number):FloorReplacementProposal=>({
        kind,reason,symbol:state.symbol,policyId:THREE_EXIT_FLOOR_POLICY_ID,
        orderEnabled:false,ordersSent:0,...(price===undefined?{}:{
            newStopPrice:price,quantity:p.quantity,existingClientOrderId:o.clientOrderId}),
    });
    if(!state.armed||!valid(state.floorStopPrice??0)||!state.effectiveFromTs)
        return response("BLOCKED","PROFIT_FLOOR_NOT_CAUSALLY_ARMED");
    if(!Number.isFinite(at)||at<state.effectiveFromTs||
        p.capturedAt<state.effectiveFromTs||o.capturedAt<state.effectiveFromTs||
        p.capturedAt>at||o.capturedAt>at)
        return response("BLOCKED","VENUE_SIGNED_EVIDENCE_TOO_OLD");
    if(o.symbol!==state.symbol||p.symbol!==state.symbol||p.side!==state.side||
        o.side!==(state.side==="LONG"?"SELL":"BUY")||o.type!=="STOP_MARKET"||
        o.reduceOnly!==true||!valid(o.orderId)||!o.clientOrderId||
        o.status!=="NEW"||o.executedQuantity!==0||
        !valid(p.quantity)||!valid(o.quantity)||Math.abs(p.quantity-o.quantity)>tolerance(p.quantity)||
        !valid(o.stopPrice)||!valid(p.markPrice))
        return response("BLOCKED","VENUE_POSITION_AND_STOP_IDENTITY_UNCERTIFIED");
    if(!valid(n)||!valid(state.floorStopPrice))
        return response("BLOCKED","STOP_PRICE_NORMALIZATION_INVALID");
    const long=state.side==="LONG";
    // Conservatively rounded profit price must secure at least the modeled floor.
    if(long?n+ tolerance(n)<state.floorStopPrice!:n-tolerance(n)>state.floorStopPrice!)
        return response("BLOCKED","NORMALIZED_STOP_UNDERPROTECTS_PROFIT_FLOOR");
    if(long?n<=o.stopPrice+tolerance(o.stopPrice):n>=o.stopPrice-tolerance(o.stopPrice))
        return response("NO_IMPROVEMENT","EXISTING_STOP_ALREADY_AT_LEAST_AS_PROTECTIVE");
    if(long?p.markPrice<=n:p.markPrice>=n)
        return response("BLOCKED","VENUE_MARK_ALREADY_CROSSED_PROFIT_STOP");
    // Place/readback/cancel/reverify in the actual owner ledger is NOT implemented by this plan.
    return response("SHADOW_READY","REQUIRES_AUTHENTICATED_OWNER_STOP_REPLACEMENT",n);
}
