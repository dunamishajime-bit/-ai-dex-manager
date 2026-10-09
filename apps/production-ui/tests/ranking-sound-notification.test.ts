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
  assert.ok(item.notes.length>=1 && item.notes.length<=3);
  assert.ok(item.notes.every(n=>n>250&&n<2000));
  assert.ok(item.length>0&&item.length<0.5);
  assert.equal(chooseRankingSound(item.id),item);
 }
 assert.equal(chooseRankingSound("unrecognized"),RANKING_SOUNDS[0]);
});

test("each currency sound schedules a playable nonzero envelope with independent oscillators",()=>{
 let started=0,stopped=0;
 const g={gain:{setValueAtTime:()=>{},linearRampToValueAtTime:()=>{},exponentialRampToValueAtTime:()=>{}},connect:()=>{}};
 const o={type:"sine",frequency:{value:0,setValueAtTime:()=>{}},connect:()=>{},start:()=>{started++},stop:()=>{stopped++}};
 const fakeCtx={currentTime:0,destination:{},createOscillator:()=>({...o,frequency:{...o.frequency}}),createGain:()=>g};
 synthesizeRankingSound(fakeCtx as unknown as AudioContext,RANKING_SOUNDS[0]);
 assert.equal(started,6);
 assert.equal(stopped,6);
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
