/** Curated original studio-rendered ranking sounds, 5 stereo recordings per role. */
export type RankingSoundRole="rise"|"fall"|"top3";
export type RankingSoundSelections=Record<RankingSoundRole,string>;
export type RankingSound={id:string;label:string;description:string;role:RankingSoundRole;src:string;duration:number};
const dir="/audio/ranking-studio-v1/";
const clip=(role:RankingSoundRole,key:string,label:string,description:string,duration:number):RankingSound=>({
 id:role+"-"+key,label,description,role,src:dir+role+"-"+key+".mp3",duration
});
export const RANKING_SOUNDS:readonly RankingSound[]=[
 clip("rise","ascend","01 アセンド・シグネチャー","堂々と立ち上がる高級シグナル",1.70),
 clip("rise","crystal","02 クリスタル・ライズ","硬質な光とガラスの余韻",1.67),
 clip("rise","momentum","03 モメンタム・スイープ","上昇する幅広いシンセとエアー",1.72),
 clip("rise","prestige","04 プレステージ・ベル","低域を伴う上質な鐘の響き",1.81),
 clip("rise","silver","05 シルバー・フライト","軽やかな金属と空間のきらめき",1.62),
 clip("fall","velvet","01 ベルベット・ディセント","柔らかい下降音と深い余韻",1.75),
 clip("fall","obsidian","02 オブシディアン","重厚で明瞭な低音インパクト",1.78),
 clip("fall","noir","03 ノワール・アラート","冷静な下降2音と低い鐘",1.67),
 clip("fall","horizon","04 ホライズン・フォール","奥行きあるピッチダウン",1.80),
 clip("fall","arc","05 ディープ・アーク","金属の降下と落ち着いた余韻",1.71),
 clip("top3","royal","01 ロイヤル・エクスチェンジ","堂々たる順位交代の特別音",2.06),
 clip("top3","executive","02 エグゼクティブ","洗練されたブラスと鍵盤の刻印",2.01),
 clip("top3","crown","03 クラウン・インパクト","重低音と華やかなホールベル",2.08),
 clip("top3","diamond","04 ダイヤモンド・シグナル","透明な金属と特別な煌めき",2.00),
 clip("top3","grand","05 グランド・フィナーレ","力強い認証音と上品な余韻",2.13),
] as const;
export const DEFAULT_RANKING_SOUND_SELECTIONS:RankingSoundSelections={
 rise:"rise-ascend",fall:"fall-velvet",top3:"top3-royal"
};
export const DEFAULT_RANKING_SOUND_ID=DEFAULT_RANKING_SOUND_SELECTIONS.rise;
export function rankingSoundsForRole(role:RankingSoundRole):RankingSound[]{
 return RANKING_SOUNDS.filter(item=>item.role===role);
}
export function chooseRankingSound(id:unknown,role:RankingSoundRole="rise"):RankingSound{
 return RANKING_SOUNDS.find(item=>item.id===id&&item.role===role)
   ??RANKING_SOUNDS.find(item=>item.id===DEFAULT_RANKING_SOUND_SELECTIONS[role])!;
}
export function loadRankingSoundSelections(input:unknown,legacy:unknown):RankingSoundSelections{
 const saved=input&&typeof input==="object"?input as Record<string,unknown>:{};
 return {
  rise:chooseRankingSound(saved.rise??legacy,"rise").id,
  fall:chooseRankingSound(saved.fall,"fall").id,
  top3:chooseRankingSound(saved.top3,"top3").id
 };
}
const cached=new WeakMap<AudioContext,Map<string,Promise<AudioBuffer>>>();
export function preloadRankingSound(ctx:AudioContext,sound:RankingSound):Promise<AudioBuffer>{
 let mapping=cached.get(ctx);
 if(!mapping){mapping=new Map();cached.set(ctx,mapping);}
 const existing=mapping.get(sound.src);
 if(existing)return existing;
 const inflight=fetch(sound.src,{cache:"force-cache"}).then(async response=>{
  if(!response.ok)throw Error("RANKING_SOUND_HTTP_"+response.status);
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength<1000)throw Error("RANKING_SOUND_EMPTY");
  return ctx.decodeAudioData(bytes.slice(0));
 });
 mapping.set(sound.src,inflight);
 void inflight.catch(()=>mapping?.delete(sound.src));
 return inflight;
}
export async function playRankingSound(
 ctx:AudioContext,sound:RankingSound,options?:{preview?:boolean;startTimestamp?:number}
):Promise<void>{
 const buffer=await preloadRankingSound(ctx,sound);
 if(!options?.preview&&options?.startTimestamp!==undefined&&Date.now()-options.startTimestamp>650)return;
 if(ctx.state!=="running")throw Error("RANKING_AUDIO_CONTEXT_NOT_RUNNING");
 const source=ctx.createBufferSource();source.buffer=buffer;
 const gain=ctx.createGain();gain.gain.value=.76;
 source.connect(gain);gain.connect(ctx.destination);source.start();
}
