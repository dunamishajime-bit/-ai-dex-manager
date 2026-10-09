/** Twenty lightweight built-in UI sounds, synthesized locally (no downloads/fees). */
export type RankingSoundRole="rise"|"fall"|"top3";
export type RankingSoundSelections=Record<RankingSoundRole,string>;
export type WaveTone = "sine" | "triangle" | "square" | "sawtooth";
export type RankingSound = {
  id:string; label:string; description:string;
  notes:readonly number[]; wave:WaveTone;
  length:number; gap:number; volume:number; shimmer?:number;
};
export const RANKING_SOUNDS: readonly RankingSound[] = [
 {id:"crystal",label:"01 クリスタル・グランデ",description:"透明な鐘と豊かな残響",notes:[659,988,1319],wave:"sine",length:1.42,gap:0.15,volume:.050,shimmer:2},
 {id:"velvet",label:"02 ベルベット・ラウンジ",description:"落ち着いた高級感ある電子ピアノ",notes:[440,554,659],wave:"triangle",length:1.55,gap:0.19,volume:.060},
 {id:"aurora",label:"03 オーロラ・シンフォニー",description:"輝きのあるシンセベル",notes:[523,784,1047],wave:"sine",length:1.62,gap:0.12,volume:.050,shimmer:2},
 {id:"marimba",label:"04 グランド・マリンバ",description:"木琴と柔らかな低域",notes:[392,523,659],wave:"triangle",length:1.37,gap:0.19,volume:.073},
 {id:"softclick",label:"05 シルキー・シグナル",description:"控えめな電子ベルと余韻",notes:[900,1200],wave:"sine",length:1.3,gap:0.18,volume:.040},
 {id:"pearl",label:"06 パール・リフレクション",description:"クリアな宝石音と残響",notes:[698,932,1175],wave:"sine",length:1.58,gap:0.14,volume:.048,shimmer:2},
 {id:"neon",label:"07 ネオン・オービット",description:"立体的な未来派シンセ",notes:[587,1175],wave:"triangle",length:1.51,gap:0.15,volume:.058},
 {id:"zen",label:"08 禅・ロイヤルベル",description:"静かな鐘と長い余韻",notes:[528],wave:"sine",length:1.74,gap:0.2,volume:.062,shimmer:2},
 {id:"luxury",label:"09 プレステージ",description:"上品なトレードファンファーレ",notes:[494,740,988],wave:"triangle",length:1.68,gap:0.14,volume:.049,shimmer:2},
 {id:"starlight",label:"10 スターライト・パレス",description:"きらめくホールベル",notes:[784,1047,1568],wave:"sine",length:1.43,gap:0.15,volume:.044},
 {id:"piano",label:"11 コンサート・ピアノ",description:"豊かな鍵盤とホール響き",notes:[523,659,784],wave:"triangle",length:1.59,gap:0.16,volume:.053},
 {id:"blossom",label:"12 ブロッサム・スイート",description:"優美なオーケストラベル",notes:[587,740,880],wave:"sine",length:1.54,gap:0.19,volume:.050},
 {id:"pulse",label:"13 プライム・パルス",description:"力強いデジタル音と上質な余韻",notes:[440,660,880],wave:"square",length:1.32,gap:0.16,volume:.025},
 {id:"mist",label:"14 ミスト・シネマ",description:"映画的な柔らかい音",notes:[349,523],wave:"sine",length:1.75,gap:0.18,volume:.054},
 {id:"chime",label:"15 エレガント・チャイム",description:"光沢のある金属ベル",notes:[659,987],wave:"triangle",length:1.53,gap:0.12,volume:.052,shimmer:2},
 {id:"breeze",label:"16 ロイヤル・ブリーズ",description:"軽やかな上昇アルペジオ",notes:[740,880,988],wave:"sine",length:1.44,gap:0.17,volume:.046},
 {id:"retro",label:"17 ネオクラシック",description:"重厚なレトロシンセ",notes:[523,784,1047],wave:"square",length:1.47,gap:0.18,volume:.022},
 {id:"orbit",label:"18 コズミック・ホール",description:"空間的な響き",notes:[659,988,740],wave:"triangle",length:1.69,gap:0.16,volume:.051},
 {id:"gold",label:"19 ゴールド・トレード",description:"厚みのある達成ファンファーレ",notes:[392,587,784],wave:"sine",length:1.76,gap:0.15,volume:.058,shimmer:2},
 {id:"diamond",label:"20 ダイヤモンド・プレミア",description:"高級クリスタルの響き",notes:[880,1175,1760],wave:"sine",length:1.61,gap:0.13,volume:.042,shimmer:2},
] as const;
export const DEFAULT_RANKING_SOUND_ID="luxury";
export const DEFAULT_RANKING_SOUND_SELECTIONS:RankingSoundSelections={rise:"crystal",fall:"velvet",top3:"luxury"};
export function chooseRankingSound(id:unknown):RankingSound{
 return RANKING_SOUNDS.find(s=>s.id===id)??RANKING_SOUNDS.find(s=>s.id===DEFAULT_RANKING_SOUND_ID)!;
}
export function loadRankingSoundSelections(input:unknown,legacy:unknown):RankingSoundSelections{
 const saved=input&&typeof input==="object"?input as Record<string,unknown>:{};
 return {
  rise:chooseRankingSound(saved.rise??legacy??DEFAULT_RANKING_SOUND_SELECTIONS.rise).id,
  fall:chooseRankingSound(saved.fall??DEFAULT_RANKING_SOUND_SELECTIONS.fall).id,
  top3:chooseRankingSound(saved.top3??DEFAULT_RANKING_SOUND_SELECTIONS.top3).id,
 };
}
export function synthesizeRankingSound(ctx:AudioContext,preset:RankingSound,role:RankingSoundRole="rise"):void{
 const start=ctx.currentTime+.012;
 const notes=role==="fall"?[...preset.notes].reverse():[...preset.notes];
 const gap=role==="top3"?Math.min(.12,preset.gap):preset.gap;
 const group=ctx.createGain();group.gain.value=.80;group.connect(ctx.destination);
 const echo=ctx.createDelay(1);echo.delayTime.value=role==="top3"?.23:.17;
 const echoLevel=ctx.createGain();echoLevel.gain.value=role==="top3"?.22:.15;
 echo.connect(echoLevel);echoLevel.connect(ctx.destination);group.connect(echo);
 const hold=Math.max(.55,preset.length-(notes.length-1)*gap);
 const tone=(freq:number,startAt:number,volume:number,wave:WaveTone,decay:number)=>{
  const oscillator=ctx.createOscillator(),envelope=ctx.createGain();
  oscillator.type=wave;oscillator.frequency.setValueAtTime(freq,startAt);
  envelope.gain.setValueAtTime(.0001,startAt);
  envelope.gain.linearRampToValueAtTime(volume,startAt+.018);
  envelope.gain.exponentialRampToValueAtTime(.0001,startAt+decay);
  oscillator.connect(envelope);envelope.connect(group);
  oscillator.start(startAt);oscillator.stop(startAt+decay+.02);
 };
 notes.forEach((hz,i)=>{
  const at=start+i*gap;
  const freq=hz*(role==="top3"?1.015:role==="fall"?.975:1);
  tone(freq,at,preset.volume,preset.wave,hold);
  tone(freq*.5,at,preset.volume*.38,"sine",Math.min(1.13,hold*.94));
  tone(freq*2.003,at,preset.volume*.23,"sine",Math.min(.80,hold*.7));
  tone(freq*3.007,at,preset.volume*.105,"sine",Math.min(.52,hold*.47));
 });
 if(role==="top3"){
  [523.25,659.25,783.99].forEach((f,i)=>{
   tone(f,start+.33+i*.015,.028,preset.wave,Math.max(.75,preset.length-.4));
   tone(f*2,start+.33+i*.015,.012,"sine",.7);
  });
 }
}
