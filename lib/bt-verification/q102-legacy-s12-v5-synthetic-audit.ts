/**
 * Legacy reconstructed Q102 S1/S2 ticker coverage on OPT-IN synthetic v5.
 * This only covers the six historical fixture symbols, NOT the unproven
 * 30 expanded native source IDs or source-authenticated stage membership.
 */
import {
  SyntheticMarket5m,
  SYNTHETIC_FEED_SYMBOLS_V5,
  type SyntheticScenario,
  type SyntheticSymbol
} from "./synthetic-market";
import {inspectQ102NativeHighVolFeaturesAt} from "./pinned-native-q102/highvol-probe";

export const LEGACY_Q102_S12_FIXTURE_SYMBOLS = Object.freeze([
  "ONDOUSDT","TAOUSDT","SUIUSDT","OPUSDT","SEIUSDT","ARBUSDT"
] as const);
export type Q102LegacySixCoverage = {
  schema:"bt481-q102-legacy-six-synthetic-v5-v1";
  source:"OWNER_LEGACY_18_ROW_FIXTURE_SYMBOLS_NOT_NATIVE_EXPANDED_30";
  seed:number;scenario:SyntheticScenario;feedVersion:"v5";
  syntheticSymbols:number;
  coveredLegacySymbols:readonly string[];
  missingLegacySymbols:readonly string[];
  completedH1:number;
  warmupH1:336;
  evaluatedH1:number;
  rawGridThresholdMatches:number;
  perSymbol:readonly {symbol:string;evaluations:number;gridMatches:number}[];
  originalNativeS1S2Expanded30IdsAvailable:false;
  historical180dClosedVenueTradesAvailable:false;
  stage1Stage2MembershipVerified:false;
  monthlyRulesVerified:false;
  nativeS1S2EntrySignals:0;
  ordersOrFills:0;
  outcome:"LEGACY_SIX_SYNTHETIC_FEATURES_ONLY";
};

export function auditLegacyQ102S12SyntheticV5(
  seed=20261116,scenario:SyntheticScenario="volatile"
):Q102LegacySixCoverage {
  const period={
    start:"2025-10-01T00:00:00Z",endExclusive:"2025-10-23T00:00:00Z",
    version:"v5" as const
  };
  const feed=new SyntheticMarket5m(seed,scenario,period);
  const all=new Set<string>(SYNTHETIC_FEED_SYMBOLS_V5);
  const missing=LEGACY_Q102_S12_FIXTURE_SYMBOLS.filter(x=>!all.has(x));
  if(missing.length)throw Error("Q102_LEGACY_S1_S2_H1_SYMBOLS_MISSING");
  const per=new Map<string,{symbol:string;evaluations:number;gridMatches:number}>();
  for(const symbol of LEGACY_Q102_S12_FIXTURE_SYMBOLS)
    per.set(symbol,{symbol,evaluations:0,gridMatches:0});
  let completedH1=0,evaluatedH1=0,totalMatches=0;
  feed.runToEnd(step=>{
    const hour=step.completedH1.find(x=>x.symbol==="BTCUSDT");
    if(!hour)return;
    if(Date.parse(hour.closedAt)!==Date.parse(step.observedAt))
      throw Error("Q102_LEGACY_CLOSED_H1_TIMESTAMP_MISMATCH");
    completedH1++;
    if(completedH1<=336)return;
    evaluatedH1++;
    for(const symbol of LEGACY_Q102_S12_FIXTURE_SYMBOLS){
      const history=feed.historyH1(symbol as SyntheticSymbol,337);
      if(history.length!==337)throw Error("Q102_LEGACY_337_CLOSED_H1_REQUIRED");
      const native=inspectQ102NativeHighVolFeaturesAt(
        symbol,history,step.observedAt
      );
      const row=per.get(symbol)!;
      row.evaluations++;
      row.gridMatches+=native.rawGridThresholdMatches;
      totalMatches+=native.rawGridThresholdMatches;
    }
  });
  if(completedH1!==528||evaluatedH1!==192 ||
    [...per.values()].some(x=>x.evaluations!==192))
    throw Error("Q102_LEGACY_V5_SYNTHETIC_WINDOW_INCOMPLETE");
  return {
    schema:"bt481-q102-legacy-six-synthetic-v5-v1",
    source:"OWNER_LEGACY_18_ROW_FIXTURE_SYMBOLS_NOT_NATIVE_EXPANDED_30",
    seed,scenario,feedVersion:"v5",
    syntheticSymbols:SYNTHETIC_FEED_SYMBOLS_V5.length,
    coveredLegacySymbols:[...LEGACY_Q102_S12_FIXTURE_SYMBOLS],
    missingLegacySymbols:missing,
    completedH1,warmupH1:336,evaluatedH1,
    rawGridThresholdMatches:totalMatches,perSymbol:[...per.values()],
    originalNativeS1S2Expanded30IdsAvailable:false,
    historical180dClosedVenueTradesAvailable:false,
    stage1Stage2MembershipVerified:false,
    monthlyRulesVerified:false,nativeS1S2EntrySignals:0,ordersOrFills:0,
    outcome:"LEGACY_SIX_SYNTHETIC_FEATURES_ONLY"
  };
}
