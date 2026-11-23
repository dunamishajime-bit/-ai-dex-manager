import type { DirectPosition } from "@/lib/direct-trade-executor";
import { readFetBrk48State, type FetBrk48State } from "@/lib/fet-brk48-state";
export interface FetBrk48OwnershipSnapshot { state?:FetBrk48State; position?:FetBrk48State["position"]; }
export async function readFetBrk48Ownership(input:{path?:string;expectedRuntimeSha?:string}={}):Promise<FetBrk48OwnershipSnapshot|undefined>{const path=input.path||process.env.FET_BRK48_STATE_PATH||"/var/lib/disdex/fet-brk48-residual/state.json";try{const state=await readFetBrk48State(path,input.expectedRuntimeSha);return{state,position:state.position};}catch{return undefined;}}
export function fetBrk48OwnsPosition(snapshot:FetBrk48OwnershipSnapshot|undefined,p:DirectPosition){const s=snapshot?.position;if(!s)return false;if(p.symbol.toUpperCase()!==s.symbol)return false;const side=p.positionSide==="SHORT"||p.quantity<0?-1:1;if(side!==1)return false;return Math.abs(Math.abs(p.quantity)-s.quantity)<=Math.max(1e-8,s.quantity*0.02);}
