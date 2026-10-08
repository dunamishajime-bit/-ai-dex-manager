export async function playRankingSequence<T>(items: readonly T[], play:(item:T)=>Promise<void>, isCurrent:()=>boolean, complete:()=>void):Promise<void>{
 for(const item of items){if(!isCurrent())return;await play(item);}
 if(isCurrent())complete();
}
