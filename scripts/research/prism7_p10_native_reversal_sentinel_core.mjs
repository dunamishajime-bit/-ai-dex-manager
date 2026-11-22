/** PRISM VII P10A FROZEN as-of two-consecutive-H1 reversal sentinel.
 * Uses source original SHORT pure position/STOP before new protective EXIT.
 * Never uses future regime label, MFE hindsight, venue order, or partial fill.
 * Pre-registered docs/research-results/PRISM7_P10_PRECOMMITTED_SOURCE_NATIVE_REVERSAL_SENTINEL_20261122.md
 */
import {evaluatePenguDualLsV2PositionBar} from './lib/pengu-dual-ls-v2.ts';
import {createPenguShortV20State} from './lib/pengu-short-v20.ts';
const H=3600000;
export function replayPinnedShortWithP10({
  evals,penguH1,btcH1,entryIndex,entryTs,entryPrice,
  requestedGross=1,exitHorizonTs
}){
 if(!Array.isArray(btcH1)||btcH1.length!==penguH1.length)
   throw Error('P10_MISSING_NATIVE_BTC_H1');
 if(!(entryPrice>0&&requestedGross>0))throw Error('P10_BAD_ENTRY');
 const anchor=evals[entryIndex-1]?.features;
 const entry=penguH1[entryIndex];
 if(!anchor||anchor.referenceTs!==entryTs-H||!entry||entry.openTime!==entryTs)
   throw Error('P10_SOURCE_ENTRY_ANCHOR_INVALID');
 if(Math.abs(entry.open-entryPrice)>1e-12)throw Error('P10_ENTRY_PRICE_CHANGED');
 const atrAbs=anchor.atr24Ratio*anchor.close;
 if(!(atrAbs>0))throw Error('P10_INVALID_ENTRY_ATR');
 let position={
   side:-1,entryTs,entryPrice,quantity:1,gross:requestedGross,
   highWaterMark:entryPrice,lowWaterMark:entryPrice,entryVersion:'SHORT_V20',
   shortV20:createPenguShortV20State({
      entryPrice,requestedGross,entryAtr24Ratio:anchor.atr24Ratio,
      btcEma168Distance:anchor.btcEma168Distance,
      btcReturn24h:anchor.btcReturn24h,
   }),
 };
 let pressureConsecutive=0;
 let floor=entryPrice;
 let maxVotes=0,pressureHours=0,eligibleHours=0;
 for(let j=entryIndex;j<evals.length;j++){
   const feat=evals[j].features;
   if(!feat||feat.referenceTs<entryTs)continue;
   if(feat.referenceTs+H>exitHorizonTs)break;
   const before=penguH1[j],btc=btcH1[j];
   if(!before||before.openTime!==feat.referenceTs||!btc||btc.openTime!==feat.referenceTs)
     throw Error('P10_SOURCE_CLOSED_H1_TIME_MISMATCH');
   // Native STOP / EXIT has priority in precisely this fully completed H1.
   const nat=evaluatePenguDualLsV2PositionBar(position,feat);
   position=nat.updatedPosition;
   if(nat.exit){
     const reason=nat.exit.reason;
     let price,kind;
     if(nat.exit.stopPrice!==undefined &&
        (reason.includes('HARD_STOP')||reason.includes('TRAILING_STOP'))){
       price=Number(nat.exit.stopPrice);kind='RESIDENT_STOP_PRICE_MODEL';
     }else{
       const next=penguH1[j+1];
       if(!next||next.openTime!==feat.referenceTs+H)
         return {status:'RIGHT_CENSORED_NO_NEXT_H1_OPEN'};
       price=Number(next.open);kind='CAUSAL_NEXT_H1_OPEN';
     }
     if(!(price>0))throw Error('P10_NATIVE_EXIT_NONPOSITIVE_PRICE');
     return {
       status:'NATIVE_EXIT_MODELED',exitTs:feat.referenceTs+H,
       decisionReferenceTs:feat.referenceTs,exitPrice:price,
       exitReason:reason,exitPriceKind:kind,
       researchP10Triggered:false,maxBuyerVotesBeforeNative:maxVotes,
       buyerPressureHoursBeforeNative:pressureHours,
       venueSignedFill:false,
     };
   }
   const printed=before.volume>0;
   if(printed)floor=Math.min(floor,before.close);
   const ageH=(feat.referenceTs+H-entryTs)/H;
   if(ageH<2||!printed){pressureConsecutive=0;continue;}
   eligibleHours++;
   const prior1=penguH1[j-1],prior2=penguH1[j-2],prior3=penguH1[j-3];
   const btcPrior3=btcH1[j-3];
   const A=!!prior1&&!!prior2&&prior1.volume>0&&prior2.volume>0&&
     before.close>prior1.close&&prior1.close>prior2.close;
   const B=!!prior3&&prior3.volume>0&&before.close/prior3.close-1>=
     0.75*anchor.atr24Ratio;
   const C=!!btcPrior3&&btc.volume>0&&btcPrior3.volume>0&&
     btc.close/btcPrior3.close-1>=0.0015;
   const D=entryPrice-floor>=atrAbs&&before.close-floor>=0.75*atrAbs;
   const votes=Number(A)+Number(B)+Number(C)+Number(D);
   maxVotes=Math.max(votes,maxVotes);
   const pressure=votes>=2;
   if(pressure)pressureHours++;
   pressureConsecutive=pressure?pressureConsecutive+1:0;
   if(pressureConsecutive<2)continue;
   const next=penguH1[j+1];
   if(!next||next.openTime!==feat.referenceTs+H)
     return {status:'RIGHT_CENSORED_P10_NO_NEXT_H1_OPEN'};
   if(!(next.open>0))throw Error('P10_RESEARCH_EXIT_PRICE_NONPOSITIVE');
   return {
      status:'NATIVE_EXIT_MODELED',exitTs:feat.referenceTs+H,
      decisionReferenceTs:feat.referenceTs,
      exitPrice:Number(next.open),exitPriceKind:'CAUSAL_NEXT_H1_OPEN_RESEARCH',
      exitReason:'P10_REVERSAL_CONFIRM_EXIT',
      researchP10Triggered:true,
      p10Evidence:{
        A_two_higher_closes:A,B_pengu_3h_075atr:B,C_btc_3h_up015pct:C,
        D_rebound_from_mfe_floor:D,votes,
        buyerConsecutiveConfirmed:pressureConsecutive,
        maxVotes,pressureHours,eligibleHours,entryAtrAbs:atrAbs,
        nextH1PositivePrint:next.volume>0,
        nextH1HasImmediatePrint:next.firstPrintMinuteOffset===0,
      },
      venueSignedFill:false,
   };
 }
 return {status:'RIGHT_CENSORED_BEFORE_NATIVE_OR_P10_EXIT'};
}
