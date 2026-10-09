import test from "node:test";
import assert from "node:assert/strict";
import {RANKING_SOUNDS,DEFAULT_RANKING_SOUND_ID,chooseRankingSound,rankingSoundsForRole,preloadRankingSound,playRankingSound} from "../lib/ranking-sounds";
import {statSync,readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {top3MovementAlert} from "../lib/ranking-top3-movement";
import {rankRows,type RankRow} from "../lib/realtime-ranking";
import {rankProvisionalRows} from "../lib/realtime-ranking-preview";

const row=(symbol:string,score:number,preview?:number):RankRow=>({
 id:symbol,symbol:symbol+"USDT",logic:"V12",side:"LONG",score,fresh:true,checkedAt:1,
 gates:[],reason:"",
 ...(preview===undefined?{}:{preview:{price:100,priceAt:1,referenceAt:0,score:preview,status:"ONE_MINUTE_REFERENCE"}}),
});

test("15 curated stereo recordings: 5 rise, 5 fall, 5 Top3",()=>{
 assert.equal(RANKING_SOUNDS.length,15);
 assert.equal(new Set(RANKING_SOUNDS.map(s=>s.id)).size,15);
 assert.equal(new Set(RANKING_SOUNDS.map(s=>s.src)).size,15);
 assert.equal(chooseRankingSound(DEFAULT_RANKING_SOUND_ID).id,DEFAULT_RANKING_SOUND_ID);
 const fingerprints=new Set<string>();
 for(const role of ["rise","fall","top3"] as const){
  const group=rankingSoundsForRole(role);
  assert.equal(group.length,5);
  for(const item of group){
   assert.equal(item.role,role);
   assert.equal(chooseRankingSound(item.id,role),item);
   assert.ok(item.duration>=1.60&&item.duration<=2.20);
   assert.match(item.src,/^\/audio\/ranking-studio-v1\/(rise|fall|top3)-[a-z]+\.mp3$/);
   const file=new URL("../public"+item.src,import.meta.url);
   const stat=statSync(file);
   assert.ok(stat.size>10_000&&stat.size<100_000,item.id);
   const bytes=readFileSync(file);
   assert.equal(bytes.subarray(0,3).toString(),"ID3","MP3 metadata header must be present");
   fingerprints.add(createHash("sha256").update(bytes).digest("hex"));
  }
 }
 assert.equal(fingerprints.size,15,"all 15 files are independently designed recordings");
 assert.equal(chooseRankingSound("old-unsupported","top3").role,"top3");
});
test("decoded sound is cached per AudioContext and playback uses the real buffer",async()=>{
 const sound=RANKING_SOUNDS[0],oldFetch=globalThis.fetch;
 let requests=0,decoded=0,starts=0;
 const audioBuffer={length:48000,duration:1.7};
 const ctx={
  state:"running",destination:{},
  decodeAudioData:async(bytes:ArrayBuffer)=>{decoded++;assert.ok(bytes.byteLength>1000);return audioBuffer;},
  createBufferSource:()=>({buffer:null,connect:()=>{},start:()=>{starts++;}}),
  createGain:()=>({gain:{value:0},connect:()=>{}})
 } as unknown as AudioContext;
 globalThis.fetch=async(url:RequestInfo|URL)=>{
  requests++;assert.equal(String(url),sound.src);
  return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1400)} as Response;
 };
 try{
  const a=await preloadRankingSound(ctx,sound);
  const b=await preloadRankingSound(ctx,sound);
  assert.equal(a,b);
  assert.equal(requests,1);
  assert.equal(decoded,1);
  await playRankingSound(ctx,sound,{preview:true});
  assert.equal(starts,1);
 }finally{globalThis.fetch=oldFetch;}
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
