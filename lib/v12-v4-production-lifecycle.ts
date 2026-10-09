import {V12_V4_MAXIMUM_DRAWDOWN} from "../config/v12V4AdoptionRiskPolicy";
/**
 * Executable OFFLINE V4 lifecycle. No venue mutation dependency or order authority.
 * Journal records are data; persistence is caller-owned and must complete before consumption.
 * Sources: run_v12_multilogic_v2.custom_exit, run_v12_multilogic_v4_final1000.stage3_candidate_all,
 * run_v12_v4_route_repair_{integrated,secondpass}.settime; frozen catalog and priority.
 * G3 native exit provenance: run_wr60_new_model.simulate_v12 params={}, 1978/1978 frozen exit parity,
 * confirmed by run_v12_logic_dissection.initialize; pure protectiveLevels/nextTrailingStop are reused.
 */
import { protectiveLevels, nextTrailingStop } from "./v12-x1-all";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";
import { normalizeDisDexV96OrderQuantity } from "./disdex-v96-order-quantity";
import { V12_V4_ROUTE_CATALOG, type V12V4ShadowCandidate } from "./v12-multilogic-v4-shadow";
import { V12_V4_V2_CAPS, V12_V4_FIRST_PASS_REPAIRS, V12_V4_SECOND_PASS_REPAIRS } from "./v12-v4-v2-shadow";

export const HOUR = 3600000;
export type ExitSpec = { kind: "TIME"; hours: number } |
  { kind: "ATR"; hours: number; tp: number; sl: number } |
  { kind: "NATIVE"; hours:number; source:"WR60_BASELINE_1978_PARITY" };
export function productionExitSpec(routeName: string): ExitSpec {
  const r = V12_V4_ROUTE_CATALOG.find(r => r.route === routeName);
  if (!r) throw Error("UNKNOWN_ROUTE");
  const override = V12_V4_SECOND_PASS_REPAIRS[routeName]?.hours ?? V12_V4_FIRST_PASS_REPAIRS[routeName]?.hours;
  if (override) return { kind: "TIME", hours: override };
  const p = r.exit_policy;
  if (p === "INHERIT_V12_STATE_EXIT") {
    if(V12_X1_ALL.stopAtr!==2.477||V12_X1_ALL.takeProfitAtr!==3.1995||V12_X1_ALL.trailingAtr!==0.20||V12_X1_ALL.maxHoldBars!==23)throw Error("NATIVE_EXIT_CONTRACT_DRIFT");
    return {kind:"NATIVE",hours:V12_X1_ALL.maxHoldBars*V12_X1_ALL.timeframeHours,source:"WR60_BASELINE_1978_PARITY"};
  }
  const tm = /^(?:TIME_(\d+)H(?:_FIXED_REFINED)?|(?:REV|ORIG)_D\d+_T(\d+))$/.exec(p);
  if (tm) return { kind: "TIME", hours: Number(tm[1] ?? tm[2]) };
  const at = /^(?:(?:REV|ORIG)_D\d+_)?TP([\d.]+)_SL([\d.]+)_H(\d+)$/.exec(p);
  if (at) return { kind: "ATR", hours: Number(at[3]), tp: Number(at[1]), sl: Number(at[2]) };
  throw Error("UNSUPPORTED_EXIT_POLICY:" + p);
}
export const PRODUCTION_EXIT_CATALOG = V12_V4_ROUTE_CATALOG.map(r => ({ route: r.route, spec: productionExitSpec(r.route) }));
export type H1Bar = { openTs: number; open: number; high: number; low: number; close: number };
export type Leg = {
  id: string; candidate: V12V4ShadowCandidate; qty: number; entryNotional: number;
  requestedQty: number; reservationUsd: number; entryTs: number; entryAtr?: number;
  status: "PENDING_ENTRY" | "OPEN" | "PENDING_EXIT" | "CLOSED" | "CANCELLED";
  exitRemainingQty: number; realizedUsd: number; feesUsd: number; fundingUsd: number;
  lastExitBarTs?: number; plannedExit?: ExitDecision;
  nativeExitEvidence?:"WR60_BASELINE_1978_PARITY"; nativeStop?:number; nativePeak?:number; previousExitBar?:H1Bar;
};
export type ExitDecision = { exitTs: number; price: number; reason: string; priceModelOnly: true };
function positive(n: number, label: string) {
  if (!Number.isFinite(n) || n <= 0) throw Error("INVALID_" + label);
}
export function evaluateProductionExit(leg: Leg, bar: H1Bar, evaluatedAt: number,
  nextOpen?: { ts: number; price: number }): ExitDecision | null {
  if (leg.qty <= 0 || leg.status !== "OPEN") return null;
  const spec = productionExitSpec(leg.candidate.route);
  if(spec.kind==="NATIVE"&&(!leg.entryAtr||leg.nativeExitEvidence!==spec.source))throw Error("NATIVE_SOURCE_ATR_EVIDENCE_REQUIRED");
  if (bar.openTs < leg.entryTs || bar.openTs % HOUR !== 0 || bar.openTs + HOUR > evaluatedAt)
    throw Error("EXIT_BAR_NOT_CAUSALLY_CLOSED");
  [bar.open, bar.high, bar.low, bar.close].forEach(x => positive(x, "BAR_PRICE"));
  if (bar.low > Math.min(bar.open, bar.close) || bar.high < Math.max(bar.open, bar.close) || bar.low > bar.high)
    throw Error("INVALID_BAR_RANGE");
  const end = leg.entryTs + spec.hours * HOUR;
  if (bar.openTs >= end) throw Error("EXIT_STREAM_SKIPPED_DEADLINE");
  if(spec.kind==="NATIVE")return evaluateNativeProductionExit(leg,bar,evaluatedAt,nextOpen).decision;
  if (spec.kind === "ATR") {
    positive(leg.entryAtr!, "ENTRY_ATR");
    const sg = leg.candidate.effectiveSide === "LONG" ? 1 : -1;
    const entry = leg.entryNotional / leg.qty;
    const stop = entry - sg * spec.sl * leg.entryAtr!;
    const tp = entry + sg * spec.tp * leg.entryAtr!;
    // Source engine evaluates stop before TP when H1 has both. Gap stop uses adverse open.
    if (sg === 1 ? bar.low <= stop : bar.high >= stop)
      return { exitTs: bar.openTs + HOUR, price: sg === 1 ? Math.min(stop, bar.open) : Math.max(stop, bar.open), reason: "STOP", priceModelOnly: true };
    if (sg === 1 ? bar.high >= tp : bar.low <= tp)
      return { exitTs: bar.openTs + HOUR, price: tp, reason: "TP", priceModelOnly: true };
  }
  if (bar.openTs + HOUR === end) {
    if (!nextOpen || nextOpen.ts !== end || nextOpen.ts > evaluatedAt) throw Error("EXIT_NEXT_OPEN_MISSING");
    positive(nextOpen.price, "NEXT_OPEN");
    return { exitTs: end, price: nextOpen.price, reason: "TIME", priceModelOnly: true };
  }
  return null;
}
export type ForeignExposure = { owner: string; symbol: string; side: "LONG" | "SHORT"; qty: number;
  gross: number; crypto: boolean; pendingGross: number };
export type InitialState = { equityUsd: number; foreign: ForeignExposure[]; holdProtected: boolean };
export type EntryEvent = { type: "RESERVE"; eventId: string; ts: number; leg: Leg };
export type Event = EntryEvent |
  { type: "ACCOUNT_MARK"; eventId:string; ts:number; equityUsd:number; prices:Record<string,number>; foreign?:ForeignExposure[] } |
  { type: "EXIT_BAR"; eventId: string; ts: number; id: string; bar: H1Bar; nextOpen?: {ts:number;price:number} } |
  { type: "ENTRY_FILL"; eventId: string; ts: number; id: string; qty: number; price: number; feeUsd: number } |
  { type: "ENTRY_TERMINAL"; eventId: string; ts: number; id: string } |
  { type: "EXIT_REQUEST"; eventId: string; ts: number; id: string; qty: number } |
  { type: "EXIT_FILL"; eventId: string; ts: number; id: string; qty: number; price: number; feeUsd: number; cooldownUntil: number } |
  { type: "FUNDING"; eventId: string; ts: number; id: string; amountUsd: number };
export type State = { initial: InitialState; foreign:ForeignExposure[]; foreignBasisEquityUsd:number; executionReview?:string; equityUsd:number; equityPeakUsd:number; maxDrawdown:number; prices:Record<string,number>; legs: Record<string, Leg>; journal: Event[]; cooldown: Record<string, number> };
function validateForeignExposures(rows:ForeignExposure[]) {
  if(!Array.isArray(rows))throw Error("INVALID_FOREIGN_INVENTORY");
  for(const x of rows){
    if(!x.owner||x.owner==="V12_V4"||!x.symbol||!["LONG","SHORT"].includes(x.side)||typeof x.crypto!=="boolean")throw Error("INVALID_FOREIGN_OWNER");
    if(!Number.isFinite(x.qty)||x.qty<0||(x.qty===0&&!(x.pendingGross>0)))throw Error("INVALID_FOREIGN_QTY");
    if(![x.gross,x.pendingGross].every(n=>Number.isFinite(n)&&n>=0))throw Error("INVALID_FOREIGN_GROSS");
    if(x.qty===0&&x.gross!==0)throw Error("UNFILLED_FOREIGN_POSITION_GROSS");
  }
}
export function createProductionState(initial: InitialState): State {
  positive(initial.equityUsd, "EQUITY");
  if(typeof initial.holdProtected!=="boolean"||!Array.isArray(initial.foreign))throw Error("INVALID_INITIAL_STATE");
  validateForeignExposures(initial.foreign);
  return { initial: structuredClone(initial), foreign:structuredClone(initial.foreign), foreignBasisEquityUsd:initial.equityUsd, equityUsd:initial.equityUsd, equityPeakUsd:initial.equityUsd,maxDrawdown:0, prices:{}, legs: {}, journal: [], cooldown: {} };
}
function key(c: V12V4ShadowCandidate) { return [c.symbol,c.route,c.effectiveSide,c.eligibleEntryTs].join(":"); }
function recovery(l: Leg) { return l.candidate.family.startsWith("RECOVERY_"); }
export function productionGross(state: State) {
  const foreignGross=(x:ForeignExposure)=>((state.prices[x.symbol]!==undefined?x.qty*state.prices[x.symbol]:x.gross*state.foreignBasisEquityUsd)+x.pendingGross*state.foreignBasisEquityUsd)/state.equityUsd;
  const foreignCrypto = state.foreign.filter(x=>x.crypto).reduce((n,x)=>n+foreignGross(x),0);
  const foreignTotal = state.foreign.reduce((n,x)=>n+foreignGross(x),0);
  const active = Object.values(state.legs).filter(x=>x.status!=="CLOSED"&&x.status!=="CANCELLED");
  const gross = (x: Leg) => ((state.prices[x.candidate.symbol]!==undefined?x.qty*state.prices[x.candidate.symbol]:x.entryNotional) + x.reservationUsd) / state.equityUsd;
  const v12 = active.reduce((n,x)=>n+gross(x),0);
  return { recovery: active.filter(recovery).reduce((n,x)=>n+gross(x),0), v12,
    crypto: foreignCrypto+v12, total: foreignTotal+v12 };
}
export type EntryPlanInput = {
  candidate: V12V4ShadowCandidate; ts: number; eventId: string; referencePrice: number;
  minimumOrderNotionalUsd: number; entryAtr?: number; nativeExitEvidence?:"WR60_BASELINE_1978_PARITY";
  quantityNormalizer: Parameters<typeof normalizeDisDexV96OrderQuantity>[0]["executor"];
};
/** Normalization reuses the existing floor/min-notional contract. Only normalizeMarketQuantity is called. */
export async function planProductionEntry(state: State, input: EntryPlanInput): Promise<EntryEvent> {
  const { candidate:c } = input;
  if (state.initial.holdProtected) throw Error("HOLD_PROTECTED");
  if(state.executionReview)throw Error("UNRESOLVED_EXECUTION_REVIEW:"+state.executionReview);
  if(state.maxDrawdown>V12_V4_MAXIMUM_DRAWDOWN+1e-12)throw Error("EQUITY_DD_OVER_OPERATOR_LIMIT");
  if (!Number.isFinite(input.ts) || input.ts !== c.eligibleEntryTs || input.ts % HOUR !== 0) throw Error("ENTRY_TIME_MISMATCH");
  if (state.foreign.some(x=>x.symbol === c.symbol)) throw Error("FOREIGN_SYMBOL_OWNERSHIP");
  if (state.legs[key(c)] || state.journal.some(x=>x.eventId===input.eventId)) throw Error("DUPLICATE_ENTRY");
  if ((state.cooldown[c.symbol+":"+c.route]??0)>input.ts) throw Error("COOLDOWN");
  const spec = productionExitSpec(c.route);
  if(spec.kind==="NATIVE"&&(input.nativeExitEvidence!==spec.source||input.ts%(2*HOUR)!==0))throw Error("NATIVE_SOURCE_ATR_EVIDENCE_REQUIRED");
  if (spec.kind==="ATR"||spec.kind==="NATIVE") positive(input.entryAtr!, "ENTRY_ATR");
  if (!Number.isFinite(c.requestedGross) || c.requestedGross<=0 || c.requestedGross>1) throw Error("INVALID_REQUESTED_GROSS");
  const active = Object.values(state.legs).filter(x=>x.status!=="CLOSED"&&x.status!=="CANCELLED");
  if (active.some(x=>x.candidate.symbol===c.symbol&&x.candidate.effectiveSide!==c.effectiveSide)) {
    // No virtual deletion. Reversal cannot reserve until every opposing close fill is reconciled.
    throw Error(c.family==="RECOVERY_Y_REVERSAL"&&active.filter(x=>x.candidate.symbol===c.symbol&&x.candidate.effectiveSide!==c.effectiveSide)
      .every(x=>["RECOVERY_X","RECOVERY_G"].includes(x.candidate.family)) ? "PREEMPT_CLOSE_FILL_REQUIRED" : "OPPOSITE_SYMBOL_ACTIVE");
  }
  if (c.family.startsWith("RECOVERY_")&&active.filter(x=>x.candidate.route===c.route).length>=16) throw Error("RECOVERY_ROUTE_SLOT_OCCUPIED");
  const equity = state.equityUsd;
  positive(input.referencePrice, "REFERENCE_PRICE");
  positive(input.minimumOrderNotionalUsd,"MINIMUM_ORDER_NOTIONAL");
  const requested = c.requestedGross*equity;
  const minGross = input.minimumOrderNotionalUsd/equity;
  const catalog = V12_V4_ROUTE_CATALOG.find(x=>x.route===c.route)!;
  if (requested<input.minimumOrderNotionalUsd && (catalog.minlift==="NO"||minGross>0.30)) throw Error("MIN_LIFT_BLOCKED");
  const notional = Math.max(requested,input.minimumOrderNotionalUsd);
  const p = await normalizeDisDexV96OrderQuantity({
    executor: input.quantityNormalizer, symbol:c.symbol, side:c.effectiveSide==="LONG"?"BUY":"SELL",
    quote: { symbol:c.symbol, bidPrice:input.referencePrice, askPrice:input.referencePrice } as any,
    deltaNotionalUsd:notional, minimumOrderNotionalUsd:input.minimumOrderNotionalUsd, reduceOnly:false,
  });
  const g=productionGross(state), worst=notional/equity;
  if (c.family.startsWith("RECOVERY_")&&g.recovery+worst>V12_V4_V2_CAPS.recoveryFamilyGross+1e-12) throw Error("RECOVERY_FAMILY_GROSS_CAP");
  if (g.v12+worst>3+1e-12) throw Error("V12_GROSS_CAP");
  if (g.crypto+worst>3.5+1e-12) throw Error("CRYPTO_GROSS_CAP");
  if (g.total+worst>4.75+1e-12) throw Error("TOTAL_GROSS_CAP");
  return { type:"RESERVE", eventId:input.eventId, ts:input.ts, leg:{
    id:key(c), candidate:structuredClone(c), qty:0, entryNotional:0, requestedQty:p.normalized.quantity,
    reservationUsd:notional, entryTs:c.eligibleEntryTs, entryAtr:input.entryAtr,nativeExitEvidence:input.nativeExitEvidence, status:"PENDING_ENTRY",
    exitRemainingQty:0, realizedUsd:0, feesUsd:0, fundingUsd:0,
  }};
}
export function applyProductionEvent(state: State, event: Event): State {
  const duplicate=state.journal.find(x=>x.eventId===event.eventId);
  if (duplicate) {
    if (JSON.stringify(duplicate)!==JSON.stringify(event)) throw Error("EVENT_ID_CONFLICT");
    return state;
  }
  if (!event.eventId || !Number.isFinite(event.ts) || event.ts<(state.journal.at(-1)?.ts??0)) throw Error("INVALID_JOURNAL_ORDER");
  const next=structuredClone(state);
  if (event.type==="ACCOUNT_MARK") {
    positive(event.equityUsd,"ACCOUNT_EQUITY");
    if(event.foreign!==undefined){validateForeignExposures(event.foreign);next.foreign=structuredClone(event.foreign);next.foreignBasisEquityUsd=event.equityUsd;}
    const symbols=new Set([...next.foreign.filter(x=>x.qty>0).map(x=>x.symbol),...Object.values(next.legs).filter(x=>x.qty>0).map(x=>x.candidate.symbol)]);
    for(const symbol of symbols)positive(event.prices[symbol],"ACCOUNT_MARK_"+symbol);
    for(const price of Object.values(event.prices))positive(price,"ACCOUNT_MARK");
    next.equityUsd=event.equityUsd;next.equityPeakUsd=Math.max(next.equityPeakUsd,event.equityUsd);
    next.maxDrawdown=Math.max(next.maxDrawdown,1-event.equityUsd/next.equityPeakUsd);
    next.prices=structuredClone(event.prices);
  } else if (event.type==="RESERVE") {
    const l=event.leg,c=l.candidate, catalog=V12_V4_ROUTE_CATALOG.find(x=>x.route===c.route);
    positive(l.requestedQty,"RESERVED_QTY");positive(l.reservationUsd,"RESERVED_USD");
    if (!catalog || c.family!==catalog.family || l.id!==key(c) || l.status!=="PENDING_ENTRY" || l.qty!==0 || l.entryNotional!==0 ||
      l.entryTs!==c.eligibleEntryTs || event.ts!==l.entryTs || c.orderEnabled!==false || c.shadow!==true ||
      !Number.isFinite(c.requestedGross) || c.requestedGross<=0 || c.requestedGross>1 || l.exitRemainingQty!==0 ||
      l.realizedUsd!==0 || l.feesUsd!==0 || l.fundingUsd!==0 ||
      (productionExitSpec(c.route).kind==="NATIVE"&&(l.nativeExitEvidence!=="WR60_BASELINE_1978_PARITY"||!l.entryAtr||l.entryTs%(2*HOUR)!==0))) throw Error("INVALID_RESERVATION");
    const active=Object.values(next.legs).filter(x=>x.status!=="CLOSED"&&x.status!=="CANCELLED");
    if(active.some(x=>x.candidate.symbol===c.symbol&&x.candidate.effectiveSide!==c.effectiveSide) ||
      (recovery(l)&&active.filter(x=>x.candidate.route===c.route).length>=16) || (next.cooldown[c.symbol+":"+c.route]??0)>event.ts) throw Error("RESERVATION_OWNERSHIP_RECHECK_FAILED");
    if (next.legs[event.leg.id]) throw Error("DUPLICATE_LEG");
    // Re-check immutable event against current reservations; planned events may race.
    const g=productionGross(next), add=event.leg.reservationUsd/next.equityUsd;
    if (next.initial.holdProtected || next.executionReview || next.maxDrawdown>V12_V4_MAXIMUM_DRAWDOWN+1e-12 || next.foreign.some(x=>x.symbol===event.leg.candidate.symbol) ||
      (recovery(event.leg)&&g.recovery+add>2.5+1e-12)||g.v12+add>3+1e-12||g.crypto+add>3.5+1e-12||g.total+add>4.75+1e-12)
      throw Error("RESERVATION_RECHECK_FAILED");
    next.legs[event.leg.id]=structuredClone(event.leg);
  } else {
    const l=next.legs[event.id];
    if (!l) throw Error("UNKNOWN_LEG");
    if (event.type==="EXIT_BAR") {
      if(l.status!=="OPEN"||l.plannedExit)throw Error("INVALID_EXIT_BAR_STATE");
      if(event.ts!==event.bar.openTs+HOUR || event.bar.openTs!==(l.lastExitBarTs===undefined?l.entryTs:l.lastExitBarTs+HOUR)) throw Error("EXIT_BAR_STREAM_GAP");
      const decision=evaluateProductionExit(l,event.bar,event.ts,event.nextOpen);
      if(productionExitSpec(l.candidate.route).kind==="NATIVE"){
        const n=evaluateNativeProductionExit(l,event.bar,event.ts,event.nextOpen);l.nativeStop=n.stop;l.nativePeak=n.peak;l.previousExitBar=event.bar;
      }
      l.lastExitBarTs=event.bar.openTs;if(decision)l.plannedExit=decision;
    } else if (event.type==="ENTRY_FILL") {
      positive(event.qty,"FILL_QTY");positive(event.price,"FILL_PRICE");
      if (l.status!=="PENDING_ENTRY" || l.qty+event.qty>l.requestedQty+1e-12 ||
        !Number.isFinite(event.feeUsd)||event.feeUsd<0) throw Error("INVALID_ENTRY_FILL");
      const actualNotional=event.qty*event.price;
      if(actualNotional>l.reservationUsd+1e-8)next.executionReview="ENTRY_FILL_OVER_RESERVED_NOTIONAL:"+l.id;
      l.qty+=event.qty;l.entryNotional+=actualNotional;l.reservationUsd=Math.max(0,l.reservationUsd-actualNotional);l.feesUsd+=event.feeUsd;
    } else if (event.type==="ENTRY_TERMINAL") {
      if(l.status!=="PENDING_ENTRY") throw Error("INVALID_ENTRY_TERMINAL");
      l.reservationUsd=0;l.status=l.qty>0?"OPEN":"CANCELLED";
    } else if (event.type==="EXIT_REQUEST") {
      positive(event.qty,"EXIT_QTY");
      if(l.status!=="OPEN"||event.qty>l.qty+1e-12) throw Error("INVALID_EXIT_REQUEST");
      l.exitRemainingQty=event.qty;l.status="PENDING_EXIT";
    } else if (event.type==="EXIT_FILL") {
      positive(event.qty,"EXIT_FILL_QTY");positive(event.price,"EXIT_FILL_PRICE");
      if(l.status!=="PENDING_EXIT"||event.qty>l.exitRemainingQty+1e-12||event.qty>l.qty+1e-12||
        !Number.isFinite(event.feeUsd)||event.feeUsd<0||!Number.isFinite(event.cooldownUntil)||event.cooldownUntil<event.ts) throw Error("INVALID_EXIT_FILL");
      const basis=l.entryNotional/l.qty, sg=l.candidate.effectiveSide==="LONG"?1:-1;
      l.realizedUsd+=sg*(event.price-basis)*event.qty;l.entryNotional-=basis*event.qty;
      l.qty-=event.qty;l.exitRemainingQty-=event.qty;l.feesUsd+=event.feeUsd;
      if(l.qty<=1e-12){l.qty=0;l.entryNotional=0;l.status="CLOSED";next.cooldown[l.candidate.symbol+":"+l.candidate.route]=event.cooldownUntil;}
      else if(l.exitRemainingQty<=1e-12){l.exitRemainingQty=0;l.status="OPEN";}
    } else if(event.type==="FUNDING") {
      if(!Number.isFinite(event.amountUsd)||l.qty<=0) throw Error("INVALID_FUNDING");
      l.fundingUsd+=event.amountUsd;
    } else throw Error("UNKNOWN_JOURNAL_EVENT");
  }
  next.journal.push(structuredClone(event));return next;
}
export function replayProductionJournal(initial: InitialState, events: Event[]): State {
  return events.reduce(applyProductionEvent,createProductionState(initial));
}
export function productionSnapshot(state: State) {
  return { ...structuredClone(state), gross:productionGross(state), orderEnabled:false as const,
    realOrderEnabledV4:0 as const, tradingMutation:0 as const, priceModelOnly:true as const,
    promotionStatus:"BLOCKED_PRODUCTION_PARITY" as const };
}

/** Causal streaming port of the frozen native simulate_v12, not the later holdout helper. */
export function evaluateNativeProductionExit(leg:Leg,bar:H1Bar,at:number,nextOpen?:{ts:number;price:number}) {
  if(leg.nativeExitEvidence!=="WR60_BASELINE_1978_PARITY"||leg.entryTs%(2*HOUR)!==0)throw Error("NATIVE_SOURCE_ATR_EVIDENCE_REQUIRED");
  positive(leg.entryAtr!,"NATIVE_SOURCE_ATR");
  if(!Number.isFinite(at)||bar.openTs<leg.entryTs||bar.openTs%HOUR!==0||bar.openTs+HOUR>at||
    bar.openTs>=leg.entryTs+46*HOUR)throw Error("NATIVE_BAR_NOT_CAUSALLY_CLOSED");
  [bar.open,bar.high,bar.low,bar.close].forEach(p=>positive(p,"NATIVE_BAR_PRICE"));
  if(bar.low>Math.min(bar.open,bar.close)||bar.high<Math.max(bar.open,bar.close)||bar.low>bar.high)throw Error("NATIVE_BAR_RANGE");
  const e=leg.entryNotional/leg.qty,sg=leg.candidate.effectiveSide==="LONG"?1:-1;
  const levels=protectiveLevels(e,leg.entryAtr!,leg.candidate.effectiveSide);
  let stop=leg.nativeStop??levels.initialStop,peak=leg.nativePeak??e;
  let decision:ExitDecision|null=null;
  const make=(price:number,reason:string)=>({price,reason,exitTs:bar.openTs+HOUR,priceModelOnly:true as const});
  if(sg===1?bar.low<=stop:bar.high>=stop)decision=make(sg===1?Math.min(stop,bar.open):Math.max(stop,bar.open),"STOP");
  if(!decision&&(sg===1?bar.high>=levels.takeProfit:bar.low<=levels.takeProfit))decision=make(levels.takeProfit,"TAKE_PROFIT");
  if(!decision&&(bar.openTs+HOUR)%(2*HOUR)===0) {
    if(!nextOpen||nextOpen.ts!==bar.openTs+HOUR||nextOpen.ts>at)throw Error("NATIVE_NEXT_OPEN_REQUIRED");
    positive(nextOpen.price,"NATIVE_NEXT_OPEN");
    const prev=leg.previousExitBar??bar;
    peak=sg===1?Math.max(peak,bar.high,prev.high):Math.min(peak,bar.low,prev.low);
    stop=nextTrailingStop(leg.candidate.effectiveSide,stop,peak,levels.trailingDistance);
    if(sg*(nextOpen.price-stop)<=0)decision=make(nextOpen.price,"TRAILING_CROSSED_BEFORE_REPLACEMENT");
  }
  const end=leg.entryTs+V12_X1_ALL.maxHoldBars*V12_X1_ALL.timeframeHours*HOUR;
  if(!decision&&bar.openTs+HOUR===end) {
    if(!nextOpen||nextOpen.ts!==end||nextOpen.ts>at)throw Error("NATIVE_NEXT_OPEN_REQUIRED");
    decision=make(nextOpen.price,"TIME_EXIT");
  }
  return {decision,stop,peak};
}
