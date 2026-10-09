/** The full rise, foreground travel and landing take 1.5s for EACH currency. */
export const RANKING_MOTION_MS = 1_500;

/** Await each group before starting the next so full visuals remain visible. */
export async function playRankingSequence<T>(
 items: readonly T[], play:(item:T)=>Promise<void>,
 isCurrent:()=>boolean, complete:()=>void,
):Promise<void>{
 for(const item of items) {
  if(!isCurrent())return;
  await play(item);
 }
 if(isCurrent())complete();
}
