/**
 * Production-causal Q102 historical availability windows. The trade selector
 * remains the exact audited LIVE function: this module only excludes an
 * unlisted/gapped symbol until it has 181 consecutive completed, valid H1 days.
 * A current opening bar contributes its open ONLY, never its final high/low/close.
 */
export const HOUR_MS = 3_600_000;
export const REQUIRED_HOURS = 181 * 24;

export function validClosedBar(row) {
  if (!row || !Number.isSafeInteger(row.timestampMs) || row.timestampMs <= 0 ||
      row.timestampMs % HOUR_MS !== 0) return false;
  const keys = ["open","high","low","close","quoteVolume"];
  if (!keys.every(k => Number.isFinite(row[k]))) return false;
  if (!(row.open > 0 && row.high > 0 && row.low > 0 && row.close > 0 &&
        row.quoteVolume >= 0 && (row.baseVolume === undefined ||
        (Number.isFinite(row.baseVolume) && row.baseVolume >= 0)))) return false;
  return row.high >= Math.max(row.open,row.close,row.low) &&
    row.low <= Math.min(row.open,row.close,row.high);
}

export function indexQ102History(candlesBySymbol) {
  if (!candlesBySymbol || typeof candlesBySymbol !== "object") throw new Error("Q102_SOURCE_REQUIRED");
  const indexed = {};
  for (const [key, rows] of Object.entries(candlesBySymbol)) {
    const symbol=String(key).trim().toUpperCase();
    if (!symbol || !Array.isArray(rows) || Object.hasOwn(indexed,symbol)) throw new Error("Q102_SOURCE_INVALID:"+key);
    const streak=new Int32Array(rows.length);
    for(let i=0;i<rows.length;i++){
      const valid=validClosedBar(rows[i]);
      const prev=i>0?rows[i-1]:undefined;
      // Any invalid or duplicated candle breaks training history. Re-entry
      // requires an entirely new contiguous 181-day lookback, not interpolation.
      const consecutive=valid && (!prev ||
        (prev.timestampMs+HOUR_MS===rows[i].timestampMs && streak[i-1]>0));
      streak[i]=!valid?0:consecutive?(i===0?1:streak[i-1]+1):1;
    }
    indexed[symbol]={rows,streak,index:0};
  }
  if (!indexed.BTCUSDT) throw new Error("Q102_BTC_HISTORY_REQUIRED");
  return indexed;
}

function currentOpen(row,decisionTs) {
  return row?.timestampMs===decisionTs && Number.isFinite(row.open) && row.open>0 ?
    {timestampMs:decisionTs,open:row.open}:null;
}

export function q102HistoryAt(indexed,decisionTs,{minimumHours=REQUIRED_HOURS}={}){
  if(!Number.isSafeInteger(decisionTs)||decisionTs<=0||decisionTs%HOUR_MS!==0||
    !Number.isSafeInteger(minimumHours)||minimumHours<1)throw new Error("Q102_ASOF_INVALID");
  const candlesBySymbol={};
  const entryOpenBySymbol={};
  const exclusions={};
  for(const [symbol,state] of Object.entries(indexed)){
    const {rows,streak}=state;
    let i=state.index;
    if(i>0 && rows[i-1]?.timestampMs>=decisionTs)i=0;
    while(i<rows.length && rows[i].timestampMs+HOUR_MS<=decisionTs)i++;
    state.index=i;
    const completed=rows[i-1];
    if(!completed||completed.timestampMs!==decisionTs-HOUR_MS){
      exclusions[symbol]="COMPLETED_1H_BAR_MISSING";continue;
    }
    if(streak[i-1]<minimumHours){
      exclusions[symbol]=streak[i-1]===0?"INVALID_LATEST_1H":"181D_CONTIGUOUS_HISTORY_NOT_READY";
      continue;
    }
    const open=currentOpen(rows[i],decisionTs);
    if(!open){exclusions[symbol]="CURRENT_ENTRY_OPEN_MISSING";continue;}
    candlesBySymbol[symbol]=rows.slice(i-minimumHours,i);
    entryOpenBySymbol[symbol]=open;
  }
  const eligibleSymbols=Object.keys(candlesBySymbol).filter(x=>x!=="BTCUSDT").sort();
  return {ready:Boolean(candlesBySymbol.BTCUSDT)&&eligibleSymbols.length>0,
    decisionTs,history:{candlesBySymbol,entryOpenBySymbol},eligibleSymbols,
    exclusions,minimumHistoryHours:minimumHours};
}
