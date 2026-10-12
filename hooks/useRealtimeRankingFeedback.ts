'use client';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createRankingMovementPhases,playRankingSequence} from '@/lib/ranking-motion-groups';
import {chooseRankingSound,playRankingSound,preloadRankingSound,loadRankingSoundSelections,rankingSoundsForRole,DEFAULT_RANKING_SOUND_SELECTIONS,type RankingSoundRole,type RankingSoundSelections} from '@/lib/ranking-sounds';
import type {RankRow} from '@/lib/realtime-ranking';

type Frame={rows:RankRow[];rects:Map<string,DOMRect>};
export function useRealtimeRankingFeedback(rows:RankRow[],version:number,viewKey:string,error:string){
 const [soundEnabled,setSoundEnabled]=useState(true),[motionEnabled,setMotionEnabled]=useState(true),[soundIds,setSoundIds]=useState<RankingSoundSelections>(DEFAULT_RANKING_SOUND_SELECTIONS),[audioNotice,setAudioNotice]=useState('');
 const current=useRef(rows),nodes=useRef(new Map<string,HTMLElement>()),captured=useRef<Frame|null>(null),previous=useRef<Frame|null>(null),seen=useRef(-1),currentView=useRef(viewKey),animations=useRef<Animation[]>([]),generation=useRef(0),audio=useRef<AudioContext|null>(null),prefs=useRef({sound:true,motion:true,soundIds:DEFAULT_RANKING_SOUND_SELECTIONS});
 current.current=rows;prefs.current={sound:soundEnabled,motion:motionEnabled,soundIds};
 const measure=useCallback(():Frame=>({rows:current.current,rects:new Map([...nodes.current].map(([id,node])=>[id,node.getBoundingClientRect()]))}),[]);
 const prepare=useCallback(()=>{captured.current=measure();},[measure]);
 const ensureAudio=useCallback(async()=>{const Audio=window.AudioContext||(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(!Audio)throw Error('AUDIO_CONTEXT_UNAVAILABLE');audio.current??=new Audio();if(audio.current.state!=='running')await audio.current.resume();return audio.current;},[]);
 const playEffect=useCallback(async(role:RankingSoundRole,force=false)=>{if(!force&&(!prefs.current.sound||document.hidden))return;try{const startedAt=Date.now(),ctx=await ensureAudio(),sound=chooseRankingSound(prefs.current.soundIds[role],role);await playRankingSound(ctx,sound,{preview:force,startTimestamp:startedAt});if(force)setAudioNotice('試聴中：'+sound.label);}catch{setAudioNotice('効果音を再生できません。効果音ONまたは試聴を押し、ブラウザの音声許可を確認してください。');}},[ensureAudio]);
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem('disdex-ranking-show')||'{}') as Record<string,unknown>;const sounds=loadRankingSoundSelections(saved.soundIds,saved.soundId);setMotionEnabled(saved.motion!==false);setSoundEnabled(saved.sound!==false);setSoundIds(sounds);prefs.current={sound:saved.sound!==false,motion:saved.motion!==false,soundIds:sounds};}catch{}return()=>{generation.current++;animations.current.forEach(animation=>animation.cancel());try{audio.current?.close().catch(()=>{});}catch{}};},[]);
 const persist=useCallback((next:{sound:boolean;motion:boolean;soundIds:RankingSoundSelections})=>{prefs.current=next;try{localStorage.setItem('disdex-ranking-show',JSON.stringify(next));}catch{}},[]);
 const toggleSound=useCallback(()=>{const value=!prefs.current.sound;setSoundEnabled(value);persist({...prefs.current,sound:value});if(value)void ensureAudio().then(()=>setAudioNotice('効果音を有効にしました。')).catch(()=>setAudioNotice('このブラウザは効果音に対応していません。'));},[ensureAudio,persist]);
 const toggleMotion=useCallback(()=>{const value=!prefs.current.motion;setMotionEnabled(value);persist({...prefs.current,motion:value});if(!value){generation.current++;animations.current.forEach(animation=>animation.cancel());animations.current=[];}},[persist]);
 const selectSound=useCallback((role:RankingSoundRole,id:string)=>{const selected=chooseRankingSound(id,role),next={...prefs.current.soundIds,[role]:selected.id};setSoundIds(next);persist({...prefs.current,soundIds:next});setAudioNotice('音色を変更しました：'+selected.label);},[persist]);
 const testSound=useCallback((role:RankingSoundRole)=>{void playEffect(role,true);},[playEffect]);
 useEffect(()=>{if(!soundEnabled)return;const Audio=window.AudioContext||(window as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(!Audio)return;audio.current??=new Audio();(['rise','fall','top3'] as const).forEach(role=>{void preloadRankingSound(audio.current!,chooseRankingSound(soundIds[role],role)).catch(()=>{});});},[soundEnabled,soundIds]);
 useLayoutEffect(()=>{
  if(currentView.current!==viewKey){currentView.current=viewKey;captured.current=null;previous.current=measure();seen.current=version;return;}
  if(version===seen.current)return;seen.current=version;
  if(version<0||error){captured.current=null;previous.current=measure();return;}
  const before=captured.current||previous.current,after=measure();captured.current=null;previous.current=after;
  if(!before||!version)return;
  const phases=createRankingMovementPhases(before.rows,after.rows);if(!phases.length)return;
  const run=++generation.current;animations.current.forEach(animation=>animation.cancel());animations.current=[];
  void playRankingSequence(phases,async phase=>{
   const moving=phase.changes.flatMap(change=>['row:'+change.id,'leader:'+change.id].flatMap(key=>{
    const node=nodes.current.get(key),old=before.rects.get(key);if(!node||!old)return [];
    const next=node.getBoundingClientRect();if(!next.width||!next.height)return [];
    const dx=old.left-next.left,dy=old.top-next.top;if(Math.abs(dx)<.5&&Math.abs(dy)<.5)return [];
    return [{node,dx,dy}];
   }));
   if(!moving.length)return;
   if(!prefs.current.motion||window.matchMedia('(prefers-reduced-motion: reduce)').matches){await playEffect(phase.role);return;}
   void playEffect(phase.role);
   await Promise.all(moving.map(({node,dx,dy})=>{
    const animation=node.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'translate(0,0)'}],{duration:phase.durationMs,easing:'cubic-bezier(.22,.7,.25,1)',fill:'none'});animations.current.push(animation);return animation.finished.catch(()=>undefined);
   }));
  },()=>generation.current===run,()=>{animations.current=[];});
 },[version,viewKey,error,measure,playEffect]);
 const register=useCallback((key:string,node:HTMLElement|null)=>{if(node)nodes.current.set(key,node);else nodes.current.delete(key);},[]);
 return {soundEnabled,motionEnabled,soundIds,audioNotice,toggleSound,toggleMotion,selectSound,testSound,register,prepare,rankingSoundsForRole};
}
