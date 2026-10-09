/** Original market UI sound effects: 20 different sonic gestures, not the same melody with new instruments. */
export type RankingSoundRole="rise"|"fall"|"top3";
export type RankingSoundSelections=Record<RankingSoundRole,string>;
export type WaveTone="sine"|"triangle"|"square"|"sawtooth";
export type SoundRecipe=
 |"flash"|"subboom"|"warp"|"woodroll"|"shutter"
 |"glass"|"laser"|"sonar"|"fanfare"|"twinkle"
 |"jazz"|"harp"|"heartbeat"|"wind"|"coins"
 |"reverse"|"arcade"|"ufo"|"impact"|"glitch";
export type RankingSound={id:string;label:string;description:string;recipe:SoundRecipe;duration:number;};
const fx=(id:string,label:string,description:string,recipe:SoundRecipe,duration:number):RankingSound=>
 ({id,label,description,recipe,duration});
export const RANKING_SOUNDS:readonly RankingSound[]=[
 fx("crystal","01 フラッシュ・シャイン","カメラフラッシュ＋鋭い光の放電","flash",0.90),
 fx("velvet","02 サブベース・ドロップ","重厚な低音がズンと落ちる","subboom",1.50),
 fx("aurora","03 ワープ・アップ","空間を駆け上がるレーザースイープ","warp",1.35),
 fx("marimba","04 ウッド・ロール","木製打楽器が連続して跳ねる","woodroll",1.00),
 fx("softclick","05 カメラ・シャッター","二段シャッターとメカニカルクリック","shutter",0.85),
 fx("pearl","06 グラス・スパーク","ガラス片の不規則なきらめき","glass",1.35),
 fx("neon","07 レーザー・ショット","2発の下降する近未来レーザー","laser",1.00),
 fx("zen","08 ソナー・エコー","深い水中に広がる単音レーダー","sonar",1.70),
 fx("luxury","09 グランド・ファンファーレ","唯一の荘厳な和音系ファンファーレ","fanfare",1.80),
 fx("starlight","10 デジタル・スター","不規則な高音の星屑エフェクト","twinkle",1.20),
 fx("piano","11 ジャズ・ラウンジ","落ち着いたジャズコードのスタブ","jazz",1.65),
 fx("blossom","12 ハープ・グリッサンド","弦を一気にはじく流れるアルペジオ","harp",1.38),
 fx("pulse","13 心拍・パルス","心拍のような低音と電子の鼓動","heartbeat",1.22),
 fx("mist","14 エアー・スウィッシュ","音階のない風切り音","wind",1.25),
 fx("chime","15 コイン・カスケード","金属コインが跳ね落ちる音","coins",1.30),
 fx("breeze","16 リバース・ライザー","吸い込まれる逆再生風＋弾ける音","reverse",1.52),
 fx("retro","17 アーケード・シーケンス","跳ねるレトロな電子SE","arcade",1.08),
 fx("orbit","18 UFO・ウォブル","ゆらぐ変調音とピッチのうねり","ufo",1.55),
 fx("gold","19 シネマ・インパクト","映画予告編風の重低音ヒット","impact",1.76),
 fx("diamond","20 グリッチ・バースト","不規則なデジタルノイズと断続音","glitch",1.25),
] as const;
export const DEFAULT_RANKING_SOUND_ID="crystal";
export const DEFAULT_RANKING_SOUND_SELECTIONS:RankingSoundSelections={rise:"aurora",fall:"velvet",top3:"luxury"};
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

/**
 * Creates one of 20 distinct sound designs without external audio assets.
 * Filters, envelopes, noise, bends and rhythmic gestures vary by recipe.
 * Every note source is finite and there is no repeating feedback loop.
 */
export function synthesizeRankingSound(ctx:AudioContext,preset:RankingSound,role:RankingSoundRole="rise"):void{
 const zero=ctx.currentTime+.012;
 const pitch=role==="fall"?.93:role==="top3"?1.025:1.035;
 const master=ctx.createGain();
 master.gain.value=.68; master.connect(ctx.destination);
 const tone=(freq:number,at:number,length:number,vol:number,wave:WaveTone="sine",finish?:number,cutoff?:number,attack=.009)=>{
  const start=zero+at, end=start+length;
  const osc=ctx.createOscillator();
  osc.type=wave;
  osc.frequency.setValueAtTime(Math.max(35,freq*pitch),start);
  if(finish!==undefined)osc.frequency.exponentialRampToValueAtTime(Math.max(35,finish*pitch),end-.008);
  const env=ctx.createGain();
  env.gain.setValueAtTime(.0001,start);
  env.gain.linearRampToValueAtTime(vol,start+Math.min(attack,length*.35));
  env.gain.exponentialRampToValueAtTime(.0001,end);
  if(cutoff){
   const filter=ctx.createBiquadFilter();
   filter.type="lowpass";filter.frequency.setValueAtTime(cutoff,start);
   osc.connect(filter);filter.connect(env);
  }else osc.connect(env);
  env.connect(master);
  osc.start(start);osc.stop(end+.009);
 };
 // Bounded filtered noise is necessary for flash, shutter, wind, clicks and electronic crackles.
 const noise=(at:number,length:number,volume:number,type:BiquadFilterType="highpass",cutoff=1000,endHz?:number,attack=.003)=>{
  const sr=ctx.sampleRate||44100;
  const frames=Math.max(100,Math.ceil(sr*length));
  const buffer=ctx.createBuffer(1,frames,sr);
  const samples=buffer.getChannelData(0);
  // Deterministic-ish local generator; does not transmit data or need a remote sound file.
  let seed=(Math.floor(at*10007)+frames+7919)>>>0;
  for(let i=0;i<frames;i++){
   seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;
   samples[i]=((seed>>>0)/2147483648-1)*.74;
  }
  const src=ctx.createBufferSource();src.buffer=buffer;
  const filter=ctx.createBiquadFilter();filter.type=type;
  filter.frequency.setValueAtTime(cutoff,zero+at);
  if(endHz!==undefined)filter.frequency.exponentialRampToValueAtTime(Math.max(80,endHz),zero+at+length);
  const env=ctx.createGain();env.gain.setValueAtTime(.0001,zero+at);
  env.gain.linearRampToValueAtTime(volume,zero+at+Math.min(attack,length*.55));
  env.gain.exponentialRampToValueAtTime(.0001,zero+at+length);
  src.connect(filter);filter.connect(env);env.connect(master);
  src.start(zero+at);src.stop(zero+at+length+.006);
 };
 switch(preset.recipe){
  case "flash": // instantaneous broadband exposure, followed by a synthetic sparkle
   noise(0,.085,.20,"highpass",4000,8500);
   tone(1700,0,.10,.047,"triangle",4800);
   noise(.12,.16,.044,"bandpass",4900,7200);
   tone(2900,.09,.39,.022,"sine",1580);break;
  case "subboom":
   tone(155,0,1.10,.16,"sine",43,undefined,.009);
   tone(85,.045,1.36,.11,"triangle",37,300);
   noise(0,.17,.065,"lowpass",1300,130);break;
  case "warp":
   tone(210,0,1.06,.075,"sawtooth",1950,3000,.32);
   tone(440,.18,.95,.040,"triangle",2750,5300,.34);
   noise(0,1.02,.073,"bandpass",280,5200,.50);
   tone(1900,.99,.24,.045,"sine",2400);break;
  case "woodroll":
   [270,360,300,420,350,500].forEach((f,i)=>{
    tone(f,i*.105,.18,.085,"triangle",f*.65,1900);
    noise(i*.105,.035,.019,"bandpass",1400,900);
   });break;
  case "shutter":
   noise(0,.042,.20,"highpass",3400);
   tone(640,0,.055,.070,"square",270,1700);
   noise(.115,.070,.16,"bandpass",2100,3800);
   tone(880,.115,.09,.062,"triangle",300);
   noise(.30,.05,.048,"highpass",4300);break;
  case "glass":
   noise(0,.052,.11,"highpass",5500);
   [1880,2630,1320,3770,2250,3190,1460].forEach((f,i)=>{
    const at=[.04,.13,.19,.27,.41,.53,.71][i];
    tone(f,at,.21+(i%3)*.14,.036,"sine",f*(i%2?1.04:.91));
   });break;
  case "laser":
   tone(2800,0,.31,.085,"sawtooth",210,4800);
   noise(0,.070,.063,"highpass",2600);
   tone(1800,.44,.39,.079,"square",145,3100);
   noise(.44,.065,.053,"highpass",3800);break;
  case "sonar":
   tone(810,0,1.36,.068,"sine",800,undefined,.005);
   tone(810,.47,1.13,.024,"sine",807);
   tone(810,.89,.77,.010,"sine",799);break;
  case "fanfare":
   // The ONLY harmonic victory cue; every other preset has a different gesture.
   [196,246.94,293.66].forEach((f,i)=>tone(f,i*.018,1.21,.055,"sawtooth",f*1.006,1800,.08));
   [392,493.88,587.33].forEach((f,i)=>tone(f,.54+i*.022,1.04,.046,"triangle",f,3300,.05));
   noise(0,.090,.051,"bandpass",1600,2700);break;
  case "twinkle":
   [1780,2795,1280,3640,2240,3140,1490,4050].forEach((f,i)=>
    tone(f,[.02,.11,.25,.29,.48,.57,.69,.87][i],.17+(i%3)*.08,.029,"sine",f*(i%2?1.025:.98)));
   break;
  case "jazz":
   [174.61,207.65,261.63,311.13,369.99].forEach((f,i)=>tone(f,i*.012,1.15,.052,"triangle",f,1250,.018));
   tone(87.31,.12,1.45,.060,"sine",85);break;
  case "harp":
   [988,740,554,440,330,247].forEach((f,i)=>{
    tone(f,i*.14,.56,.060,"triangle",f*.998,2600);
    tone(f*2.01,i*.14,.23,.009,"sine");
   });break;
  case "heartbeat":
   tone(83,0,.22,.12,"sine",52);
   tone(98,.27,.32,.10,"sine",62);
   noise(.60,.040,.073,"highpass",2100);
   tone(770,.63,.22,.041,"square",730,2000);
   tone(83,.87,.28,.093,"sine",46);break;
  case "wind":
   noise(0,1.08,.12,"bandpass",180,4300,.34);
   noise(.18,.96,.060,"highpass",400,2300,.29);
   noise(.81,.29,.047,"lowpass",1800,280);break;
  case "coins":
   [1240,1837,990,1520,2133,870].forEach((f,i)=>{
    tone(f,[0,.09,.22,.37,.55,.74][i],.26+(i%2)*.13,.054,"triangle",f*.88,3500);
    tone(f*2.53,[0,.09,.22,.37,.55,.74][i],.085,.017,"sine");
   });break;
  case "reverse":
   noise(0,.96,.11,"bandpass",280,4200,.75);
   tone(180,.15,.82,.043,"sine",910,undefined,.58);
   noise(.94,.090,.14,"highpass",2900);
   tone(1480,.95,.34,.036,"triangle",500);break;
  case "arcade":
   [440,660,350,980,550,1220].forEach((f,i)=>{
    tone(f,[0,.11,.26,.39,.58,.72][i],.080+(i%2)*.055,.067,"square",f*(i%2?1.2:.83),3000);
   });break;
  case "ufo":
   tone(410,0,.48,.065,"sawtooth",690,1400,.08);
   tone(690,.46,.51,.073,"sawtooth",260,1900,.025);
   tone(280,.95,.44,.070,"triangle",840,2500,.095);
   noise(.08,1.11,.038,"bandpass",1100,400);break;
  case "impact":
   noise(0,.185,.20,"lowpass",2600,90);
   tone(120,0,1.40,.16,"sine",39);
   tone(67,.055,1.63,.11,"triangle",35,200);
   noise(.38,.62,.043,"bandpass",380,100);break;
  case "glitch":
   [0,.045,.14,.18,.31,.52,.56,.64,.77,.89].forEach((at,i)=>{
    if(i%3===0)noise(at,.038,.085,"highpass",4000);
    else tone([260,1390,590,2140,410,2800,710,1670,330,1090][i],at,.058,.058,i%2?"square":"sawtooth",i%2?1100:250);
   });break;
 }
}
