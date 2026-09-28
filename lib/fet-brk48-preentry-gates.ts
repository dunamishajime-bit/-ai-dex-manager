import type { FetBrk48Bar } from "@/lib/fet-brk48-signal";

/** Research-equal 73+25 strictly pre-entry H1 FET gates. Never real venue fills. */
export type FetEntryGateDecision = {
  allow: boolean;
  reason: "PASS" | "FET_PREENTRY_OVERHEAT_24H_15PCT_ATR_2PCT" | "FET_PREENTRY_RELATIVE_WEAK_BTC_AND_FET24H_LT_1PCT";
  fetReturn24h: number; btcReturn24h: number; relative24h: number; fetAtr24hPct: number;
};
const HOUR = 3_600_000;
function contiguous(rows: readonly FetBrk48Bar[], entryTs: number, count: number, symbol: string): FetBrk48Bar[] {
  if (!Number.isSafeInteger(entryTs) || entryTs <= 0 || entryTs % HOUR) throw new Error("FET_GATE_INVALID_ENTRY_TS");
  const a = rows.filter((r) => r.openTs < entryTs).slice(-count);
  if (a.length !== count) throw new Error("FET_GATE_MISSING_H1:" + symbol + ":" + count);
  for (let i = 0; i < count; i += 1) {
    const r = a[i], expected = entryTs - (count - i) * HOUR;
    if (r.openTs !== expected || r.closeTs >= entryTs || r.closeTs < r.openTs ||
        ![r.open,r.high,r.low,r.close].every((v) => Number.isFinite(v) && v > 0) ||
        r.high < Math.max(r.open,r.close) || r.low > Math.min(r.open,r.close) ||
        !Number.isFinite(r.volume) || r.volume < 0) {
      throw new Error("FET_GATE_INVALID_OR_GAPPED_H1:" + symbol + ":" + expected);
    }
  }
  return a;
}
export function evaluateFetBrk48PreEntryGates(fetHistory: readonly FetBrk48Bar[],
  btcHistory: readonly FetBrk48Bar[], entryTs: number): FetEntryGateDecision {
  const fet = contiguous(fetHistory,entryTs,73,"FETUSDT");
  const btc = contiguous(btcHistory,entryTs,25,"BTCUSDT");
  const fetReturn24h=fet[72].close/fet[48].close-1;
  const btcReturn24h=btc[24].close/btc[0].close-1;
  const relative24h=fetReturn24h-btcReturn24h;
  let total=0;
  for(let i=49;i<73;i+=1){
    const prior=fet[i-1].close, bar=fet[i];
    total+=Math.max(bar.high-bar.low,Math.abs(bar.high-prior),Math.abs(bar.low-prior))/prior;
  }
  const fetAtr24hPct=total/24;
  if(![fetReturn24h,btcReturn24h,relative24h,fetAtr24hPct].every(Number.isFinite))
    throw new Error("FET_GATE_INVALID_FEATURES");
  const features={fetReturn24h,btcReturn24h,relative24h,fetAtr24hPct};
  if(fetReturn24h>=.15&&fetAtr24hPct>=.02)
    return {allow:false,reason:"FET_PREENTRY_OVERHEAT_24H_15PCT_ATR_2PCT",...features};
  if(relative24h<0&&fetReturn24h<.01)
    return {allow:false,reason:"FET_PREENTRY_RELATIVE_WEAK_BTC_AND_FET24H_LT_1PCT",...features};
  return {allow:true,reason:"PASS",...features};
}
