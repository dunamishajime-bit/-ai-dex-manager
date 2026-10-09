import type {RankingSoundRole} from "./ranking-sounds";
export type MovementRow={id:string;rank?:number;score?:number|null};
export type Movement={id:string;from:number;to:number;role:RankingSoundRole};
export type MovementPhase={role:RankingSoundRole;changes:Movement[];durationMs:number};

/** An exchange touching the top three uses its own balanced pair/group animation. */
export function classifyRankingMove(from:number|undefined,to:number|undefined):RankingSoundRole|null {
 if(!Number.isInteger(from)||!Number.isInteger(to)||!from||!to||from===to)return null;
 if(from<=3||to<=3)return "top3";
 return to<from?"rise":"fall";
}
/**
 * Three bounded waves: Top3 exchange, ordinary rises, ordinary falls.
 * Every currency in a wave moves together. Top3 peers swap simultaneously.
 */
export function createRankingMovementPhases(
 previous:readonly MovementRow[],next:readonly MovementRow[],
):MovementPhase[]{
 const before=new Map(previous.map(row=>[row.id,row]));
 const groups:Record<RankingSoundRole,Movement[]>={top3:[],rise:[],fall:[]};
 for(const now of next){
  const old=before.get(now.id);
  if(!old||old.score===null||now.score===null)continue;
  const role=classifyRankingMove(old.rank,now.rank);
  if(!role)continue;
  groups[role].push({id:now.id,from:old.rank!,to:now.rank!,role});
 }
 return (["top3","rise","fall"] as const)
  .filter(role=>groups[role].length>0)
  .map(role=>({
   role,
   changes:groups[role].sort((a,b)=>a.to-b.to),
   durationMs:role==="top3"?1900:1500,
  }));
}
