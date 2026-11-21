/**
 * Shared SOURCE-PINNED PENGU SHORT V20 standalone native EXIT reproduction.
 * Source pure functions imported from immutable pin using import-only adapter.
 * No owner admission, signed fill, funding, shared Gross, or live operations.
 */
import {evaluatePenguDualLsV2PositionBar} from './lib/pengu-dual-ls-v2.ts';
import {createPenguShortV20State} from './lib/pengu-short-v20.ts';

const H=3600000;
export function replayPinnedShortExit({
    evals,penguH1,entryIndex,entryTs,entryPrice,
    requestedGross=1,exitHorizonTs,
}){
    if(!(requestedGross>0 && entryPrice>0))throw Error('NATIVE_INPUT_INVALID_GROSS_PRICE');
    const anchor=evals[entryIndex-1]?.features;
    const entry=penguH1[entryIndex];
    if(!anchor||anchor.referenceTs!==entryTs-H ||
       !entry||entry.openTime!==entryTs)
       throw Error('NATIVE_ENTRY_ANCHOR_NOT_SOURCE_CONTIGUOUS');
    if(Math.abs(entry.open-entryPrice)>1e-12)
       throw Error('NATIVE_SOURCE_ENTRY_PRICE_MISMATCH');

    let position={
        side:-1,entryTs,entryPrice,quantity:1,gross:requestedGross,
        highWaterMark:entryPrice,lowWaterMark:entryPrice,
        entryVersion:'SHORT_V20',
        shortV20:createPenguShortV20State({
            entryPrice,requestedGross,
            entryAtr24Ratio:anchor.atr24Ratio,
            btcEma168Distance:anchor.btcEma168Distance,
            btcReturn24h:anchor.btcReturn24h,
        }),
    };
    for(let j=entryIndex;j<evals.length;j++){
        const f=evals[j].features;
        if(!f || f.referenceTs<entryTs)continue;
        if(f.referenceTs+H>exitHorizonTs)break;
        const result=evaluatePenguDualLsV2PositionBar(position,f);
        position=result.updatedPosition;
        if(!result.exit)continue;
        const reason=result.exit.reason;
        let exitPrice,kind;
        if(result.exit.stopPrice!==undefined &&
            (reason.includes('HARD_STOP')||reason.includes('TRAILING_STOP'))){
            exitPrice=Number(result.exit.stopPrice);
            kind='RESIDENT_STOP_PRICE_MODEL';
        }else{
            const next=penguH1[j+1];
            if(!next || next.openTime!==f.referenceTs+H)
                return {status:'RIGHT_CENSORED_NO_NEXT_H1_OPEN'};
            exitPrice=Number(next.open);
            kind='CAUSAL_NEXT_H1_OPEN';
        }
        if(!(exitPrice>0))throw Error('NATIVE_EXIT_NONPOSITIVE_PRICE');
        return {
            status:'NATIVE_EXIT_MODELED',
            exitTs:f.referenceTs+H,
            decisionReferenceTs:f.referenceTs,
            exitPrice,
            exitReason:reason,
            exitPriceKind:kind,
            sourceNativeStopPureFunction:true,
            venueSignedFill:false,
        };
    }
    return {status:'RIGHT_CENSORED_BEFORE_NATIVE_EXIT'};
}
