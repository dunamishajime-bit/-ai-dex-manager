import type {RankingSoundRole} from './ranking-sounds';
export type MovementRow={id:string;rank?:number;score?:number|null};
export type Movement={id:string;from:number;to:number;role:RankingSoundRole};
export type MovementPhase={role:RankingSoundRole;changes:Movement[];durationMs:number};
export function classifyRankingMove(from:number|undefined,to:number|undefined):RankingSoundRole|null{
 if(!Number.isInteger(from)||!Number.isInteger(to)||!from||!to||from===to)return null;
 if(from<=3||to<=3)return 'top3';
 return to<from?'rise':'fall';
}
export function createRankingMovementPhases(previous:readonly MovementRow[],next:readonly MovementRow[]):MovementPhase[]{
 const before=new Map(previous.map(row=>[row.id,row]));
 const groups:Record<RankingSoundRole,Movement[]>={top3:[],rise:[],fall:[]};
 for(const now of next){
  const old=before.get(now.id);
  if(!old||old.score===null||old.score===0||now.score===null||now.score===0||!old.rank||!now.rank)continue;
  const role=classifyRankingMove(old.rank,now.rank);if(!role)continue;
  groups[role].push({id:now.id,from:old.rank,to:now.rank,role});
 }
 return (['top3','rise','fall'] as const).filter(role=>groups[role].length>0).map(role=>({role,changes:groups[role].sort((a,b)=>a.to-b.to),durationMs:role==='top3'?1900:1500}));
}
export const RANKING_MOTION_MS=1500;
export async function playRankingSequence<T>(items:readonly T[],play:(item:T)=>Promise<void>,isCurrent:()=>boolean,complete:()=>void):Promise<void>{
 for(const item of items){if(!isCurrent())return;await play(item);}if(isCurrent())complete();
}
