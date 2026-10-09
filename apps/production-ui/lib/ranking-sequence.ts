export async function playRankingSequence<T>(items: readonly T[], play:(item:T)=>Promise<void>, isCurrent:()=>boolean, complete:()=>void):Promise<void>{
 for(const item of items){if(!isCurrent())return;await play(item);}
 if(isCurrent())complete();
}

/** Hard visual budget, independent of how many currencies changed rank. */
export const RANKING_MOTION_MS = 1_500;
export const RANKING_STAGGER_MAX_MS = 180;
export function rankingMovementTiming(index:number) {
 const delay=Math.min(Math.max(0,index)*35,RANKING_STAGGER_MAX_MS);
 return {delay,duration:RANKING_MOTION_MS-delay};
}
/** Animate multiple ranking moves together, rather than 3.6s per currency. */
export async function playRankingSequenceConcurrent<T>(
 items:readonly T[], play:(item:T,index:number)=>Promise<void>,
 isCurrent:()=>boolean,complete:()=>void,
):Promise<void>{
 if(!isCurrent())return;
 await Promise.all(items.map((item,index)=>isCurrent()?play(item,index):Promise.resolve()));
 if(isCurrent())complete();
}
