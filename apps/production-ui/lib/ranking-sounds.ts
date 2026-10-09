/** Twenty lightweight built-in UI sounds, synthesized locally (no downloads/fees). */
export type WaveTone = "sine" | "triangle" | "square" | "sawtooth";
export type RankingSound = {
  id:string; label:string; description:string;
  notes:readonly number[]; wave:WaveTone;
  length:number; gap:number; volume:number; shimmer?:number;
};
export const RANKING_SOUNDS: readonly RankingSound[] = [
 {id:"crystal",label:"01 クリスタル",description:"澄んだガラスの上昇音",notes:[659,988,1319],wave:"sine",length:.22,gap:.085,volume:.050,shimmer:2},
 {id:"velvet",label:"02 ベルベット",description:"柔らかなラウンジ音",notes:[440,554,659],wave:"triangle",length:.27,gap:.082,volume:.060},
 {id:"aurora",label:"03 オーロラ",description:"広がる透明なベル",notes:[523,784,1047],wave:"sine",length:.34,gap:.1,volume:.050,shimmer:2},
 {id:"marimba",label:"04 マリンバ",description:"温かい木琴の短い響き",notes:[392,523,659],wave:"triangle",length:.15,gap:.115,volume:.073},
 {id:"softclick",label:"05 ソフトクリック",description:"控えめな高級感のあるクリック",notes:[900,1200],wave:"sine",length:.065,gap:.085,volume:.040},
 {id:"pearl",label:"06 パール",description:"真珠のような繊細な音",notes:[698,932,1175],wave:"sine",length:.16,gap:.09,volume:.048,shimmer:2},
 {id:"neon",label:"07 ネオン",description:"未来的な2音シグナル",notes:[587,1175],wave:"triangle",length:.14,gap:.155,volume:.058},
 {id:"zen",label:"08 禅ベル",description:"静かなシングルベル",notes:[528],wave:"sine",length:.49,gap:.1,volume:.062,shimmer:2},
 {id:"luxury",label:"09 ラグジュアリー",description:"落ち着いた金属音",notes:[494,740,988],wave:"triangle",length:.2,gap:.1,volume:.049,shimmer:2},
 {id:"starlight",label:"10 スターライト",description:"星が弾ける軽い和音",notes:[784,1047,1568],wave:"sine",length:.16,gap:.075,volume:.044},
 {id:"piano",label:"11 ミニピアノ",description:"短い鍵盤音",notes:[523,659,784],wave:"triangle",length:.2,gap:.11,volume:.053},
 {id:"blossom",label:"12 ブロッサム",description:"やさしい上昇3音",notes:[587,740,880],wave:"sine",length:.26,gap:.097,volume:.050},
 {id:"pulse",label:"13 パルス",description:"デジタルで歯切れよく",notes:[440,660,880],wave:"square",length:.08,gap:.10,volume:.025},
 {id:"mist",label:"14 ミスト",description:"霧のようなソフト音",notes:[349,523],wave:"sine",length:.39,gap:.13,volume:.054},
 {id:"chime",label:"15 チャイム",description:"上品な2音の鐘",notes:[659,987],wave:"triangle",length:.26,gap:.14,volume:.052,shimmer:2},
 {id:"breeze",label:"16 ブリーズ",description:"軽快で優しい音",notes:[740,880,988],wave:"sine",length:.14,gap:.075,volume:.046},
 {id:"retro",label:"17 レトロ",description:"小さなゲーム音",notes:[523,784,1047],wave:"square",length:.075,gap:.08,volume:.022},
 {id:"orbit",label:"18 オービット",description:"宇宙的な高低の変化",notes:[659,988,740],wave:"triangle",length:.19,gap:.11,volume:.051},
 {id:"gold",label:"19 ゴールド",description:"深みのある成功音",notes:[392,587,784],wave:"sine",length:.29,gap:.115,volume:.058,shimmer:2},
 {id:"diamond",label:"20 ダイヤモンド",description:"きらめく繊細な上昇音",notes:[880,1175,1760],wave:"sine",length:.19,gap:.072,volume:.042,shimmer:2},
] as const;
export const DEFAULT_RANKING_SOUND_ID = "crystal";
export function chooseRankingSound(id:unknown):RankingSound {
  return RANKING_SOUNDS.find(sound=>sound.id===id)??RANKING_SOUNDS[0];
}
/** Plays one sound at the beginning of each currency's 1.5s journey. */
export function synthesizeRankingSound(ctx:AudioContext,preset:RankingSound) {
 const start=ctx.currentTime+.008;
 preset.notes.forEach((frequency,i)=>{
  const begin=start+i*preset.gap;
  const wave=ctx.createOscillator(),gain=ctx.createGain();
  wave.type=preset.wave;wave.frequency.setValueAtTime(frequency,begin);
  gain.gain.setValueAtTime(.0001,begin);
  gain.gain.linearRampToValueAtTime(preset.volume,begin+.012);
  gain.gain.exponentialRampToValueAtTime(.0001,begin+preset.length);
  wave.connect(gain);gain.connect(ctx.destination);
  wave.start(begin);wave.stop(begin+preset.length+.015);
  if(preset.shimmer) {
   const partial=ctx.createOscillator(),soft=ctx.createGain();
   partial.type="sine";partial.frequency.value=frequency*preset.shimmer;
   soft.gain.setValueAtTime(.0001,begin);
   soft.gain.linearRampToValueAtTime(preset.volume*.16,begin+.01);
   soft.gain.exponentialRampToValueAtTime(.0001,begin+preset.length*.75);
   partial.connect(soft);soft.connect(ctx.destination);
   partial.start(begin);partial.stop(begin+preset.length+.015);
  }
 });
}
