/** Frozen research score horizon; separate from native exit-policy contracts.
 * Source: 9e1142f5 three_layer_layer2_online_ensemble_20261114.py expected_hold_hours.
 * Keep its precedence and route-name fallbacks, including repaired-route quirks.
 */
export interface Stable4ExpectedHoldInput {
 strategy:string;side:"LONG"|"SHORT";route:string;entrySnapshot?:Readonly<Record<string,unknown>>;
}
export function expectedStable4OpportunityHoldHours(input:Stable4ExpectedHoldInput):number{
 const v=input.entrySnapshot??{};
 const number=(value:unknown):value is number=>{
  if(typeof value!=="number")return false;
  if(!Number.isFinite(value))throw Error("STABLE4_EXPECTED_HOLD_NONFINITE_METADATA");
  return true;
 };
 for(const key of ["holdHours","maxHoldHours"])if(number(v[key]))return Math.max(1,v[key]);
 if(input.strategy==="PENGU"){
  const value=v[input.side==="LONG"?"longMaxHoldHours":"shortMaxHoldHours"];
  if(number(value))return Math.max(1,value);
 }
 if(input.strategy==="HYPE"&&input.route.includes("H48"))return 48;
 if(input.strategy==="V52"){
  const a=v.entry_ts_ms,b=v.forced_flat_ms;
  if(number(a)&&number(b)&&b>a)return Math.max(1,(b-a)/3600000);
 }
 for(const pattern of [/TIME_(\d+)H/,/_H(\d+)(?:_|$)/,/_T(\d+)(?:_|$)/]){
  const match=pattern.exec(input.route);if(match)return Math.max(1,Number(match[1]));
 }
 return 24;
}
