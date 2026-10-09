import test from "node:test";
import assert from "node:assert/strict";
import {RANKING_SOUNDS,DEFAULT_RANKING_SOUND_ID,chooseRankingSound,synthesizeRankingSound} from "../lib/ranking-sounds";
import {top3MovementAlert} from "../lib/ranking-top3-movement";
import {rankRows,type RankRow} from "../lib/realtime-ranking";
import {rankProvisionalRows} from "../lib/realtime-ranking-preview";

const row=(symbol:string,score:number,preview?:number):RankRow=>({
 id:symbol,symbol:symbol+"USDT",logic:"V12",side:"LONG",score,fresh:true,checkedAt:1,
 gates:[],reason:"",
 ...(preview===undefined?{}:{preview:{price:100,priceAt:1,referenceAt:0,score:preview,status:"ONE_MINUTE_REFERENCE"}}),
});

test("20 distinct, selectable, synthetically rendered sound presets",()=>{
 assert.equal(RANKING_SOUNDS.length,20);
 assert.equal(new Set(RANKING_SOUNDS.map(x=>x.id)).size,20);
 assert.equal(chooseRankingSound(DEFAULT_RANKING_SOUND_ID).id,DEFAULT_RANKING_SOUND_ID);
 for(const item of RANKING_SOUNDS){
  assert.ok(item.label&&item.description);
  assert.ok(item.duration>=0.75&&item.duration<=1.85);
  assert.ok(item.recipe);
  assert.equal(chooseRankingSound(item.id),item);
 }
 assert.equal(chooseRankingSound("unrecognized").id,DEFAULT_RANKING_SOUND_ID);
});

test("all 20 SFX have distinct synthesis gestures instead of the same melody",()=>{
 const signatures=new Set<string>();
 const recipeNames=new Set<string>();
 for(const preset of RANKING_SOUNDS){
  recipeNames.add(preset.recipe);
  const starts:string[]=[];
  const stops:number[]=[];
  let bends=0,noiseBuffers=0,filters=0;
  const gain=()=>({value:0,setValueAtTime:()=>{},linearRampToValueAtTime:()=>{},exponentialRampToValueAtTime:()=>{}});
  const oscillator=()=>({
   type:"sine",frequency:{setValueAtTime:(_f:number,_t:number)=>{},exponentialRampToValueAtTime:()=>{bends++;}},
   connect:()=>{},start:(time:number)=>{starts.push("osc:"+time.toFixed(3));},stop:(time:number)=>{stops.push(time);}
  });
  const fakeCtx={
   currentTime:0,sampleRate:8000,destination:{},
   createGain:()=>({gain:gain(),connect:()=>{}}),
   createOscillator:()=>oscillator(),
   createBiquadFilter:()=>{filters++;return {type:"lowpass",frequency:gain(),connect:()=>{}};},
   createBuffer:(_channels:number,frames:number)=>{noiseBuffers++;return {getChannelData:()=>new Float32Array(frames)};},
   createBufferSource:()=>({buffer:null,connect:()=>{},start:(time:number)=>{starts.push("noise:"+time.toFixed(3));},stop:(time:number)=>{stops.push(time);}}),
  };
  synthesizeRankingSound(fakeCtx as unknown as AudioContext,preset,"rise");
  assert.ok(starts.length>=1,preset.id);
  assert.equal(stops.length,starts.length,preset.id);
  assert.ok(stops.every(t=>t>0&&t<=preset.duration+.10),preset.id);
  signatures.add(JSON.stringify({starts,bends,noiseBuffers,filters}));
 }
 assert.equal(recipeNames.size,20,"all 20 presets need a distinct recipe");
 assert.equal(signatures.size,20,"all 20 sounds must differ in timing, source type, or modulation");
});
test("SFX flash, laser, wind, bass and Top3 fanfare use different source families",()=>{
 const find=(id:string)=>RANKING_SOUNDS.find(p=>p.id===id)!.recipe;
 assert.equal(find("crystal"),"flash");
 assert.equal(find("neon"),"laser");
 assert.equal(find("mist"),"wind");
 assert.equal(find("velvet"),"subboom");
 assert.equal(find("luxury"),"fanfare");
});
test("formal Top3 swap always notifies even when scores below 90",()=>{
 const before=[row("BTC",70),row("ETH",68),row("SOL",65),row("LINK",63)];
 const after=[row("ETH",75),row("BTC",70),row("SOL",65),row("LINK",63)];
 const alert=top3MovementAlert(before,after,"正式");
 assert.equal(alert?.reason,"TOP3_MOVEMENT");
 assert.match(alert?.body??"",/ETH.*2位→1位/);
});
test("new entrant from fourth into Top3 notifies",()=>{
 const a=[row("BTC",90),row("ETH",80),row("SOL",70),row("LINK",65)];
 const b=[row("BTC",90),row("LINK",88),row("ETH",80),row("SOL",70)];
 const alert=top3MovementAlert(a,b,"正式");
 assert.match(alert?.title??"",/新規入り/);
 assert.match(alert?.body??"",/LINK.*4位→2位/);
});
test("top3 stable should not produce duplicate notifications",()=>{
 const a=[row("BTC",90),row("ETH",80),row("SOL",70),row("LINK",66)];
 assert.equal(top3MovementAlert(a,a,"正式"),null);
 assert.equal(top3MovementAlert([],a,"正式"),null);
});
test("provisional Top3 changes notification is separate from formal ranking",()=>{
 const a=[row("BTC",90,90),row("ETH",80,80),row("SOL",70,70),row("LINK",66,66)];
 const b=[row("BTC",90,90),row("ETH",80,80),row("SOL",70,70),row("LINK",66,89)];
 const before=rankProvisionalRows(a,true);
 const after=rankProvisionalRows(b,true);
 assert.equal(top3MovementAlert(rankRows(a),rankRows(b),"正式"),null);
 const alert=top3MovementAlert(before,after,"暫定");
 assert.equal(alert?.reason,"TOP3_MOVEMENT");
 assert.match(alert?.body??"",/LINK.*4位→2位/);
});
test("no false provisional Top3 movement if prices have not been observed",()=>{
 const a=[row("BTC",90),row("ETH",80),row("SOL",70),row("LINK",60)];
 assert.equal(top3MovementAlert(rankProvisionalRows(a,true),rankProvisionalRows(a,true),"暫定"),null);
});
