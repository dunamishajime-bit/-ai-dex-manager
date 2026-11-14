import type {Quality102Candle} from "./disdex-quality102-causal-pipeline";
const fields=["timestampMs","open","high","low","close","baseVolume","quoteVolume"] as const;
/** Bounded memo of exact completed training windows, never later candles. */
export class CausalHistoryMemo<T>{
 private readonly entries=new Map<string,{window:Float64Array;value:T|undefined}>();
 constructor(private readonly capacity=16){if(!Number.isSafeInteger(capacity)||capacity<1||capacity>64)throw Error("CAUSAL_MEMO_CAPACITY_INVALID");}
 get(key:string,rows:readonly Quality102Candle[],compute:()=>T|undefined):T|undefined{
  const previous=this.entries.get(key);
  const equal=previous&&previous.window.length===rows.length*fields.length&&rows.every((row,i)=>fields.every((field,j)=>Object.is(previous.window[i*fields.length+j],row[field]??NaN)));
  if(equal){this.entries.delete(key);this.entries.set(key,previous);return structuredClone(previous.value);}
  const value=compute(),window=new Float64Array(rows.length*fields.length);
  rows.forEach((row,i)=>fields.forEach((field,j)=>{window[i*fields.length+j]=row[field]??NaN;}));
  this.entries.delete(key);this.entries.set(key,{window,value:structuredClone(value)});
  while(this.entries.size>this.capacity)this.entries.delete(this.entries.keys().next().value!);
  return value;
 }
}
