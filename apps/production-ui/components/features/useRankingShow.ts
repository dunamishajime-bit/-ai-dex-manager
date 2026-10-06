'use client';
import { useCallback,useEffect,useLayoutEffect,useRef,useState } from 'react';
import { rankCommentary,risingRankEvents,type RankRow,type RiseEvent } from '@/lib/realtime-ranking';

type Capture={rows:RankRow[];rects:Map<string,DOMRect>;scrollX:number;scrollY:number};
export function useRankingShow(rows:RankRow[],version:number,viewKey:string,error:string){
 const [event,setEvent]=useState<RiseEvent|null>(null),[highlights,setHighlights]=useState<Record<string,number>>({});
 const [sound,setSound]=useState(false),[voice,setVoice]=useState(false),[motion,setMotion]=useState(true);
 const [audioNotice,setAudioNotice]=useState('');
 const current=useRef(rows);current.current=rows;
 const previous=useRef<Capture|null>(null),capture=useRef<Capture|null>(null),seen=useRef(''),filters=useRef(viewKey);
 const nodes=useRef(new Map<string,HTMLElement>()),clones=useRef<HTMLElement[]>([]),animations=useRef<Animation[]>([]);
 const speechTimer=useRef<ReturnType<typeof setTimeout>>(),wasBlocked=useRef(false),hiddenNodes=useRef<HTMLElement[]>([]);
 const timer=useRef<ReturnType<typeof setTimeout>>(),audio=useRef<AudioContext|null>(null),voiceSource=useRef<AudioBufferSourceNode|null>(null),prefs=useRef({sound,voice,motion}),lastAudio=useRef(0);
 prefs.current={sound,voice,motion};
 const measure=useCallback(():Capture=>({rows:current.current,rects:new Map([...nodes.current].map(([id,n])=>[id,n.getBoundingClientRect()])),scrollX:window.scrollX,scrollY:window.scrollY}),[]);
 const prepare=useCallback(()=>{capture.current=measure();},[measure]);
 const stopVisuals=useCallback(()=>{animations.current.forEach(a=>a.cancel());animations.current=[];clones.current.forEach(n=>n.remove());clones.current=[];hiddenNodes.current.forEach(n=>{n.style.opacity='';});hiddenNodes.current=[];if(speechTimer.current)clearTimeout(speechTimer.current);if(timer.current)clearTimeout(timer.current);},[]);
 const ensureAudio=useCallback(async()=>{
  const Audio=window.AudioContext||(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  if(!Audio)throw new Error('AUDIO_CONTEXT_UNAVAILABLE');
  audio.current??=new Audio();
  if(audio.current.state!=='running')await audio.current.resume();
  return audio.current;
 },[]);
 const fallbackSpeech=useCallback((text:string)=>{
  if(!('speechSynthesis' in window))return;
  window.speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(text);u.lang='ja-JP';u.rate=.92;u.pitch=.98;u.volume=1;
  const ja=window.speechSynthesis.getVoices().filter(v=>v.lang.toLowerCase().startsWith('ja'));
  const preferred=
   ja.find(v=>/google.*日本語|google.*japanese/i.test(v.name))||
   ja.find(v=>/nanami|keita|ayumi|natural|neural/i.test(v.name))||
   ja.find(v=>!v.localService)||
   ja[0];
  if(preferred)u.voice=preferred;
  window.speechSynthesis.speak(u);
 },[]);
 const speakNatural=useCallback(async(text:string)=>{
  try{
   const ctx=await ensureAudio();
   const res=await fetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,voice:'marin'}),cache:'no-store'});
   if(!res.ok)throw new Error('TTS_HTTP_'+res.status);
   const buffer=await res.arrayBuffer(),decoded=await ctx.decodeAudioData(buffer.slice(0));
   try{voiceSource.current?.stop();}catch{}
   const source=ctx.createBufferSource();source.buffer=decoded;source.connect(ctx.destination);voiceSource.current=source;
   source.onended=()=>{if(voiceSource.current===source)voiceSource.current=null;};
   source.start();
   setAudioNotice('AI生成の自然音声（marin）で実況しています。');
  }catch{
   setAudioNotice('AI自然音声を取得できないため、端末音声へ切り替えました。');
   fallbackSpeech(text);
  }
 },[ensureAudio,fallbackSpeech]);
 useEffect(()=>{
  try{const saved=JSON.parse(localStorage.getItem('disdex-ranking-show')||'{}');setMotion(saved.motion!==false);}catch{}
  return()=>{stopVisuals();try{voiceSource.current?.stop();}catch{}audio.current?.close().catch(()=>{});if('speechSynthesis' in window)window.speechSynthesis.cancel();};
 },[stopVisuals]);
 const preference=useCallback((key:'sound'|'voice'|'motion',value:boolean)=>{
  const p={...prefs.current,[key]:value};prefs.current=p;
  if(key==='sound')setSound(value);if(key==='voice')setVoice(value);if(key==='motion')setMotion(value);
  try{localStorage.setItem('disdex-ranking-show',JSON.stringify({motion:p.motion}));}catch{}
  if(key==='sound'&&value){
   void ensureAudio().catch(()=>{setSound(false);setAudioNotice('このブラウザは効果音に未対応です。');});
  }
  if(key==='voice'){
   if(!value){try{voiceSource.current?.stop();}catch{}if('speechSynthesis' in window)window.speechSynthesis.cancel();setAudioNotice('AI音声実況はOFFです。');}
   else void speakNatural('自然音声実況を有効にしました。ランキングが動いたときに、変化をお知らせします。');
  }
 },[ensureAudio,speakNatural]);
 const notify=useCallback((rise:RiseEvent,delay:number)=>{
  if(document.hidden||Date.now()-lastAudio.current<20000)return;
  const p=prefs.current;if(!p.sound&&!p.voice)return;lastAudio.current=Date.now();
  if(p.sound){
   void ensureAudio().then(ctx=>{
    const t=ctx.currentTime;
    [660,880].forEach((frequency,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=frequency;o.type='sine';g.gain.setValueAtTime(0,t+i*.09);g.gain.linearRampToValueAtTime(.035,t+i*.09+.02);g.gain.exponentialRampToValueAtTime(.001,t+i*.09+.2);o.connect(g);g.connect(ctx.destination);o.start(t+i*.09);o.stop(t+i*.09+.22);});
   }).catch(()=>{});
  }
  if(p.voice)speechTimer.current=setTimeout(()=>{
   if(document.hidden||!prefs.current.voice)return;
   void speakNatural(rankCommentary(rise.row,rise.from,rise.to).speech);
  },delay);
 },[ensureAudio,speakNatural]);
 useLayoutEffect(()=>{
  const token=String(version);
  if(filters.current!==viewKey||error||document.hidden||wasBlocked.current||Number(version)<Number(seen.current)){stopVisuals();setHighlights({});setEvent(null);previous.current=measure();capture.current=null;seen.current=token;filters.current=viewKey;wasBlocked.current=!!error;return;}
  if(seen.current===token)return;
  seen.current=token;stopVisuals();
  const before=capture.current||previous.current,after=measure();capture.current=null;previous.current=after;
  if(!before)return;
  const rises=risingRankEvents(before.rows,current.current).filter(r=>nodes.current.has(r.row.id));
  setEvent(rises[0]??null);setHighlights(Object.fromEntries(rises.map(r=>[r.row.id,r.delta])));
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let visualDuration=0;
  if(prefs.current.motion&&!reduced){
   // Animate every visible displaced row and leader card, in either direction.
   // Leader registration uses a separate key so cards cannot overwrite row measurements.
   const risingIds=new Set(rises.map(r=>r.row.id));
   const oldRows=new Map(before.rows.map(row=>[row.id,row]));
   const newRows=new Map(current.current.map(row=>[row.id,row]));
   [...nodes.current].forEach(([key,node])=>{
    const id=key.startsWith('leader:')?key.slice(7):key;
    const oldRow=oldRows.get(id),newRow=newRows.get(id),old=before.rects.get(key),end=node.getBoundingClientRect();
    if(!oldRow?.fresh||!newRow?.fresh||oldRow.score===null||newRow.score===null)return;
    if(!old||!end.width||old.bottom<0||old.top>innerHeight||end.bottom<0||end.top>innerHeight)return;
    if(Math.abs(old.left+before.scrollX-window.scrollX-end.left)<.5&&Math.abs(old.top+before.scrollY-window.scrollY-end.top)<.5)return;
    const startX=old.left+before.scrollX-window.scrollX,startY=old.top+before.scrollY-window.scrollY;
    const clone=node.cloneNode(true) as HTMLElement;
    clone.removeAttribute('id');clone.removeAttribute('data-ranking-row');clone.removeAttribute('data-ranking-leader');clone.setAttribute('aria-hidden','true');clone.setAttribute('inert','');
    clone.classList.add('ranking-flyer');
    Object.assign(clone.style,{position:'fixed',left:end.left+'px',top:end.top+'px',width:end.width+'px',height:end.height+'px',zIndex:risingIds.has(id)?'150':'100',pointerEvents:'none',background:'#20291c',border:'1px solid #efd58c',borderRadius:'6px',margin:'0'});
    document.body.appendChild(clone);clones.current.push(clone);node.style.opacity='0';hiddenNodes.current.push(node);
    const dx=startX-end.left,dy=startY-end.top,isRising=risingIds.has(id);
    const scale=Math.max(1,Math.min(1.8,(innerWidth-32)/end.width));
    const marginX=(scale-1)*end.width/2,marginY=(scale-1)*end.height/2,lift=Math.min(90,Math.max(64,end.height*.7));
    const foregroundX=(x:number)=>Math.max(16+marginX,Math.min(innerWidth-end.width-marginX-16,end.left+x))-end.left;
    const foregroundY=(y:number)=>Math.max(16+marginY,Math.min(innerHeight-end.height-marginY-16,end.top+y-lift))-end.top;
    const shadow='0 36px 64px #000d, 0 0 36px #f4d77f99';
    // Rise at the old position, hold in the foreground, travel above other
    // currencies, then descend into the authoritative destination.
    const frames=isRising?[
     {transform:`translate(${dx}px,${dy}px) scale(1)`,boxShadow:'0 0 0 transparent',offset:0},
     {transform:`translate(${foregroundX(dx)}px,${foregroundY(dy)}px) scale(${scale})`,boxShadow:shadow,offset:.2},
     {transform:`translate(${foregroundX(dx)}px,${foregroundY(dy)}px) scale(${scale})`,boxShadow:shadow,offset:.34},
     {transform:`translate(${foregroundX(0)}px,${foregroundY(0)}px) scale(${scale})`,boxShadow:shadow,offset:.74},
     {transform:'translate(0,-8px) scale(1.12)',boxShadow:'0 12px 24px #0009, 0 0 24px #f4d77f66',offset:.9},
     {transform:'translate(0,0) scale(1)',boxShadow:'0 0 24px #e8ce7e55',offset:1}
    ]:[
     {transform:`translate(${dx}px,${dy}px) scale(1)`,offset:0},
     {transform:'translate(0,0) scale(1)',offset:1}
    ];
    const duration=isRising?2400:1800;
    visualDuration=Math.max(visualDuration,duration);
    const a=clone.animate(frames,{duration,easing:'cubic-bezier(.22,.7,.25,1)',fill:'both'});
    animations.current.push(a);
    a.onfinish=()=>{clone.remove();node.style.opacity='';if(rises[0]?.row.id===id&&prefs.current.motion&&!reduced)node.animate([{backgroundColor:'#e5d38d66'},{backgroundColor:'#ffffff01'}],{duration:1400});};
   });
  }
  if(rises[0])notify(rises[0],visualDuration?visualDuration+100:0);
  timer.current=setTimeout(()=>{stopVisuals();setHighlights({});setEvent(null);},12000);
 },[version,viewKey,error,measure,stopVisuals,notify]);
 const register=useCallback((id:string,node:HTMLElement|null)=>{if(node)nodes.current.set(id,node);else nodes.current.delete(id);},[]);
 return {event,highlights,prepare,register,sound,voice,motion,preference,audioNotice};
}
