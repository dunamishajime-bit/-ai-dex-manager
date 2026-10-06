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
 const timer=useRef<ReturnType<typeof setTimeout>>(),audio=useRef<AudioContext|null>(null),prefs=useRef({sound,voice,motion}),lastAudio=useRef(0);
 prefs.current={sound,voice,motion};
 const measure=useCallback(():Capture=>({rows:current.current,rects:new Map([...nodes.current].map(([id,n])=>[id,n.getBoundingClientRect()])),scrollX:window.scrollX,scrollY:window.scrollY}),[]);
 const prepare=useCallback(()=>{capture.current=measure();},[measure]);
 const stopVisuals=useCallback(()=>{animations.current.forEach(a=>a.cancel());animations.current=[];clones.current.forEach(n=>n.remove());clones.current=[];hiddenNodes.current.forEach(n=>{n.style.opacity='';});hiddenNodes.current=[];if(speechTimer.current)clearTimeout(speechTimer.current);if(timer.current)clearTimeout(timer.current);},[]);
 useEffect(()=>{
  try{const saved=JSON.parse(localStorage.getItem('disdex-ranking-show')||'{}');setMotion(saved.motion!==false);}catch{}
  return()=>{stopVisuals();audio.current?.close().catch(()=>{});if(prefs.current.voice&&'speechSynthesis' in window)window.speechSynthesis.cancel();};
 },[stopVisuals]);
 const preference=useCallback((key:'sound'|'voice'|'motion',value:boolean)=>{
  const p={...prefs.current,[key]:value};prefs.current=p;
  if(key==='sound')setSound(value);if(key==='voice')setVoice(value);if(key==='motion')setMotion(value);
  try{localStorage.setItem('disdex-ranking-show',JSON.stringify({motion:p.motion}));}catch{}
  if(key==='sound'&&value){
   const Audio=window.AudioContext||(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
   if(!Audio){setSound(false);setAudioNotice('このブラウザは効果音に未対応です。');return;}
   audio.current??=new Audio();void audio.current.resume().catch(()=>setAudioNotice('効果音を再度オンにしてください。'));
  }
  if(key==='voice'){
   if(!('speechSynthesis' in window)){setVoice(false);setAudioNotice('このブラウザは読み上げに未対応です。');return;}
   if(!value)window.speechSynthesis.cancel();
   else {const u=new SpeechSynthesisUtterance('ランキング実況を有効にしました。');u.lang='ja-JP';window.speechSynthesis.speak(u);}
  }
 },[]);
 const notify=useCallback((rise:RiseEvent,delay:number)=>{
  if(document.hidden||Date.now()-lastAudio.current<20000)return;
  const p=prefs.current;if(!p.sound&&!p.voice)return;lastAudio.current=Date.now();
  if(p.sound&&audio.current?.state==='running'){
   const ctx=audio.current,t=ctx.currentTime;
   [660,880].forEach((frequency,i)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=frequency;o.type='sine';g.gain.setValueAtTime(0,t+i*.09);g.gain.linearRampToValueAtTime(.035,t+i*.09+.02);g.gain.exponentialRampToValueAtTime(.001,t+i*.09+.2);o.connect(g);g.connect(ctx.destination);o.start(t+i*.09);o.stop(t+i*.09+.22);});
  }
  if(p.voice)speechTimer.current=setTimeout(()=>{
   if(document.hidden||!prefs.current.voice||!('speechSynthesis' in window)||window.speechSynthesis.speaking)return;
   const u=new SpeechSynthesisUtterance(rankCommentary(rise.row,rise.from,rise.to).speech);u.lang='ja-JP';u.rate=1.05;
   // Browser/OS voice only; no model or external speech API requests.
   u.onerror=()=>setAudioNotice('読み上げを利用できません。ブラウザの日本語音声設定を確認してください。');
   window.speechSynthesis.speak(u);
  },delay);
 },[]);
 useLayoutEffect(()=>{
  const token=String(version);
  if(filters.current!==viewKey||error||document.hidden||wasBlocked.current||Number(version)<Number(seen.current)){stopVisuals();setHighlights({});setEvent(null);previous.current=measure();capture.current=null;seen.current=token;filters.current=viewKey;wasBlocked.current=!!error;return;}
  if(seen.current===token)return;
  seen.current=token;stopVisuals();
  const before=capture.current||previous.current,after=measure();capture.current=null;previous.current=after;
  if(!before)return;
  const rises=risingRankEvents(before.rows,current.current).filter(r=>nodes.current.has(r.row.id));
  if(!rises.length){setHighlights({});setEvent(null);return;}
  setEvent(rises[0]);setHighlights(Object.fromEntries(rises.map(r=>[r.row.id,r.delta])));
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(prefs.current.motion&&!reduced){
   // Fixed overlays travel across ranking columns without clipping or resizing the table.
   rises.filter(r=>nodes.current.has(r.row.id)).slice(0,3).forEach((rise,index)=>{
    const node=nodes.current.get(rise.row.id)!,old=before.rects.get(rise.row.id),end=node.getBoundingClientRect();
    if(!old||!end.width||old.bottom<0||old.top>innerHeight||end.bottom<0||end.top>innerHeight)return;
    const startX=old.left+before.scrollX-window.scrollX,startY=old.top+before.scrollY-window.scrollY;
    const clone=node.cloneNode(true) as HTMLElement;
    clone.removeAttribute('id');clone.removeAttribute('data-ranking-row');clone.setAttribute('aria-hidden','true');clone.setAttribute('inert','');
    clone.classList.add('ranking-flyer');
    Object.assign(clone.style,{position:'fixed',left:end.left+'px',top:end.top+'px',width:end.width+'px',height:end.height+'px',zIndex:'100',pointerEvents:'none',background:'#20291c',border:'1px solid #efd58c',borderRadius:'6px',margin:'0'});
    document.body.appendChild(clone);clones.current.push(clone);node.style.opacity='0';hiddenNodes.current.push(node);
    const dx=startX-end.left,dy=startY-end.top;
    const a=clone.animate([
     {transform:`translate(${dx}px,${dy}px) scale(1)`,boxShadow:'0 0 0 transparent',offset:0},
     {transform:`translate(${dx}px,${dy-6}px) scale(1.04)`,boxShadow:'0 14px 32px #000b, 0 0 16px #e8ce7e66',offset:.2},
     {transform:'translate(0,-4px) scale(1.04)',boxShadow:'0 14px 32px #000b, 0 0 16px #e8ce7e66',offset:.82},
     {transform:'translate(0,0) scale(1)',boxShadow:'0 0 24px #e8ce7e55',offset:1}
    ],{duration:1150,delay:index*100,easing:'cubic-bezier(.22,.7,.25,1)',fill:'both'});
    animations.current.push(a);
    a.onfinish=()=>{clone.remove();node.style.opacity='';if(index===0&&prefs.current.motion&&!reduced)node.animate([{backgroundColor:'#e5d38d66'},{backgroundColor:'#ffffff01'}],{duration:1400});};
   });
  }
  notify(rises[0],prefs.current.motion&&!reduced?1400:0);
  timer.current=setTimeout(()=>{stopVisuals();setHighlights({});setEvent(null);},12000);
 },[version,viewKey,error,measure,stopVisuals,notify]);
 const register=useCallback((id:string,node:HTMLElement|null)=>{if(node)nodes.current.set(id,node);else nodes.current.delete(id);},[]);
 return {event,highlights,prepare,register,sound,voice,motion,preference,audioNotice};
}
