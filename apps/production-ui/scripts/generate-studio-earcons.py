#!/usr/bin/env python3
"""Render 15 original DisDex studio earcons as stereo 48kHz MP3.

Five designs per role: rising, falling, Top3. Real samples with acoustic layers,
stereo early reflections and peak safety, rather than a WebAudio oscillator beep.
Requires numpy and ffmpeg. Deterministic fixed-seed rendering.
"""
from __future__ import annotations
import math, subprocess, tempfile, wave, json, hashlib
from pathlib import Path
import numpy as np

SR=48000
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public'/'audio'/'ranking-studio-v1'
RNG=np.random.default_rng(20261009)

BANK=[
 ('rise','ascend','アセンド・シグネチャー','堂々と立ち上がる高級シグナル',1.70),
 ('rise','crystal','クリスタル・ライズ','硬質な光とガラスの余韻',1.67),
 ('rise','momentum','モメンタム・スイープ','上昇する幅広いシンセとエアー',1.72),
 ('rise','prestige','プレステージ・ベル','低域を伴う上質な鐘の響き',1.81),
 ('rise','silver','シルバー・フライト','軽やかな金属と空間のきらめき',1.62),
 ('fall','velvet','ベルベット・ディセント','柔らかい下降音と深い余韻',1.75),
 ('fall','obsidian','オブシディアン','重厚で明瞭な低音インパクト',1.78),
 ('fall','noir','ノワール・アラート','冷静な下降2音と低い鐘',1.67),
 ('fall','horizon','ホライズン・フォール','奥行きあるピッチダウン',1.80),
 ('fall','arc','ディープ・アーク','金属の降下と落ち着いた余韻',1.71),
 ('top3','royal','ロイヤル・エクスチェンジ','堂々たる順位交代の特別音',2.06),
 ('top3','executive','エグゼクティブ','洗練されたブラスと鍵盤の刻印',2.01),
 ('top3','crown','クラウン・インパクト','重低音と華やかなホールベル',2.08),
 ('top3','diamond','ダイヤモンド・シグナル','透明な金属と特別な煌めき',2.00),
 ('top3','grand','グランド・フィナーレ','力強い認証音と上品な余韻',2.13),
]

def envelope(t,attack=.009,release=.45):
 return (1-np.exp(-t/max(.001,attack)))*np.exp(-t/max(.02,release))

class Studio:
 def __init__(self,duration,seed):
  self.n=int(SR*duration)
  self.x=np.zeros((self.n,2),dtype=np.float64)
  self.rng=np.random.default_rng(seed)
 def put(self,a,at=0,volume=.2,pan=0):
  pos=int(at*SR);n=min(len(a),self.n-pos)
  if n<=0:return
  pan=np.clip(pan,-1,1)
  left=np.cos((pan+1)*np.pi/4)
  right=np.sin((pan+1)*np.pi/4)
  self.x[pos:pos+n,0]+=a[:n]*volume*left
  self.x[pos:pos+n,1]+=a[:n]*volume*right
 def bell(self,f,at,decay=.58,volume=.26,pan=0,metal=.35,soft=False):
  n=min(int(SR*min(1.8,decay*2.45)),self.n-int(at*SR))
  if n<2:return
  t=np.arange(n)/SR
  ratios=(1.,2.004,3.91,5.43,8.20)
  weights=(1,.35+metal*.16,.20+metal*.13,.12+metal*.13,.055)
  wave_=np.zeros(n)
  for k,(r,w) in enumerate(zip(ratios,weights)):
   wave_+=w*np.sin(2*np.pi*f*r*t+(k*.59))*np.exp(-t/(decay/(1+k*.38)))
  wave_*=1-np.exp(-t/(.008 if soft else .0018))
  self.put(wave_,at,volume,pan)
 def tone(self,f,at,length=.45,volume=.15,pan=0,attack=.008,decay=.36,detune=0):
  n=min(int(SR*length),self.n-int(at*SR))
  if n<2:return
  t=np.arange(n)/SR
  phases=2*np.pi*f*t
  a=np.sin(phases)+.28*np.sin(phases*2+.2)+.12*np.sin(phases*3+.9)
  if detune:a+=.28*np.sin(phases*(1+detune)+1.0)
  a*=envelope(t,attack,decay)
  self.put(a,at,volume,pan)
 def sweep(self,start,end,at,length,volume=.16,pan=0,airy=.02):
  n=min(int(SR*length),self.n-int(at*SR))
  if n<2:return
  t=np.arange(n)/SR
  f=start*np.exp(np.log(end/start)*(t/length)**1.35)
  phase=2*np.pi*np.cumsum(f)/SR
  a=(np.sin(phase)+.20*np.sin(2*phase+.45))*np.sin(np.pi*np.minimum(1,t/length))**.68
  if airy:
   w=self.rng.standard_normal(n)
   # airy broadband colored with a gentle numerical high-pass
   w=np.append(w[0],np.diff(w))
   w/=max(1,np.max(np.abs(w)))
   a+=w*airy
  self.put(a,at,volume,pan)
 def noise(self,at,duration,vol=.07,pan=0,pitch=0,attack=.005):
  n=min(int(SR*duration),self.n-int(at*SR))
  if n<2:return
  t=np.arange(n)/SR
  w=self.rng.standard_normal(n)
  # frequency shaping by subtracting exponential moving averages
  s=np.cumsum(w)
  blur=(s-np.concatenate((np.zeros(64),s[:-64])))/64
  a=w-blur if pitch>0 else blur
  a=a/(np.max(np.abs(a))+1e-6)
  a*=envelope(t,attack,duration*.28)
  self.put(a,at,vol,pan)
 def kick(self,at,vol=.34,pan=0,fall=42):
  n=min(int(SR*.65),self.n-int(at*SR))
  t=np.arange(n)/SR
  freq=fall+135*np.exp(-t*31)
  phase=2*np.pi*np.cumsum(freq)/SR
  a=(np.sin(phase)+.14*np.sin(2*phase))*envelope(t,.0015,.19)
  self.put(a,at,vol,pan)
  self.noise(at,.065,vol*.22,pan,pitch=1)
 def room(self,wet=.18):
  # spatial early reflections and distinct left/right delays, no feedback
  base=self.x.copy()
  for sec,gain,leftfirst in [(0.029,.13,True),(.047,.12,False),(.071,.11,True),(.113,.10,False),(.169,.08,True),(.233,.055,False)]:
   shift=int(SR*sec)
   if shift>=self.n:continue
   if leftfirst:
    self.x[shift:,0]+=base[:-shift,1]*gain*wet
    self.x[shift:,1]+=base[:-shift,0]*gain*wet*.63
   else:
    self.x[shift:,1]+=base[:-shift,0]*gain*wet
    self.x[shift:,0]+=base[:-shift,1]*gain*wet*.62
 def master(self):
  # soft clipping preserves transients, unlike strict hard clipping
  self.room(.92)
  self.x=np.tanh(self.x*1.06)
  peak=float(np.max(np.abs(self.x)))
  if peak<.01:raise RuntimeError('silent output')
  # integrated loudness approximation; prevent painful peaks and preserve headroom
  rms=float(np.sqrt(np.mean(self.x**2)))
  target=.13
  gain=min(.79/peak,target/max(.00001,rms))
  self.x*=gain
  fade=min(int(SR*.13),self.n//8)
  self.x[-fade:]*=np.linspace(1,0,fade)[:,None]**1.4
  return np.asarray(np.clip(self.x,-1,1)*32767,dtype='<i2'),float(np.max(np.abs(self.x))),float(np.sqrt(np.mean(self.x**2)))

def render(role,key,dur):
 a=Studio(dur,abs(int(hashlib.sha256((role+key).encode()).hexdigest()[:8],16)))
 if role=='rise':
  if key=='ascend':
   a.kick(0,.24,fall=65);a.sweep(280,1250,.02,.58,.19,pan=-.25)
   for i,f in enumerate([392,587.33,783.99]):a.bell(f,.15+i*.125,.63,.15,pan=[-.40,.24,0][i],metal=.55)
   a.tone(196,.03,.76,.16,pan=-.07,decay=.35)
  elif key=='crystal':
   a.noise(0,.085,.12,pan=.20,pitch=1)
   for i,(f,t) in enumerate([(1174.7,.02),(1759.9,.16),(1318.5,.29),(2349.3,.44)]):
    a.bell(f,t,.43,.17,pan=(-.7 if i%2 else .67),metal=.85)
   a.bell(587.3,.10,.95,.12,pan=0,metal=.3)
  elif key=='momentum':
   a.sweep(190,1630,0,.79,.31,pan=-.2,airy=.10)
   a.noise(.22,.61,.085,pan=.4,pitch=1)
   a.kick(.72,.15,fall=61)
   a.bell(880,.73,.52,.21,pan=.16)
  elif key=='prestige':
   a.kick(0,.17,fall=62)
   for i,f in enumerate((523.25,659.25,783.99)):
    a.bell(f,.04+i*.14,.80,.23,pan=[-.38,.28,-.05][i],soft=True,metal=.65)
   a.tone(261.62,.08,1.30,.10,decay=.78)
  else:
   a.noise(0,.11,.10,pan=-.8,pitch=1)
   for i,(f,t) in enumerate(((880,.08),(1175,.19),(1568,.31),(2093,.47),(1318,.59))):
    a.bell(f,t,.37,.13,pan=-.6+.29*i,metal=.8)
   a.sweep(510,1600,.02,.65,.10,pan=.10)
 elif role=='fall':
  if key=='velvet':
   a.sweep(940,210,0,.67,.15,pan=.05)
   for i,f in enumerate((440,329.63,220)):
    a.bell(f,.06+i*.16,.84,.17,pan=.25-i*.20,soft=True,metal=.22)
   a.tone(110,.20,1.15,.11,decay=.73)
  elif key=='obsidian':
   a.kick(0,.46,fall=41);a.noise(0,.15,.13,pitch=0)
   a.tone(98,.08,1.22,.19,decay=.60)
   a.bell(196,.28,.88,.15,pan=-.2,metal=.17)
  elif key=='noir':
   a.bell(622.25,0,.45,.21,pan=-.3,metal=.2)
   a.bell(392,.32,.94,.24,pan=.3,metal=.2)
   a.tone(155.56,.34,.93,.13,decay=.63)
   a.noise(.31,.06,.054,pitch=1)
  elif key=='horizon':
   a.noise(0,.42,.10,pan=-.18)
   a.sweep(1480,110,.11,.90,.26,pan=.12,airy=.06)
   a.kick(.74,.18,fall=46)
   a.bell(329.63,.89,.52,.12)
  else:
   a.bell(783.99,0,.41,.13,metal=.9,pan=.5)
   a.sweep(1100,170,.14,.58,.20,pan=-.30)
   a.bell(246.94,.69,.77,.19,pan=-.2,metal=.45)
   a.tone(123.47,.58,.98,.10,decay=.62)
 else:
  if key=='royal':
   a.kick(0,.24,fall=68)
   for i,f in enumerate((392,493.88,587.33)):a.bell(f,.11+i*.15,.77,.19,pan=[-.34,.32,0][i],metal=.50)
   for i,f in enumerate((784,987.77,1174.66)):a.bell(f,.75+i*.04,.76,.19,pan=[.25,-.15,.22][i],metal=.76)
   a.tone(196,.16,1.48,.16,decay=.73)
  elif key=='executive':
   a.noise(0,.058,.085,pitch=1);a.kick(.02,.22,fall=59)
   a.tone(246.94,.06,1.21,.14,pan=-.18,decay=.63,detune=.005)
   a.tone(311.13,.08,1.18,.11,pan=.20,decay=.64,detune=.002)
   a.tone(369.99,.10,1.15,.13,decay=.65)
   a.bell(739.99,.69,.82,.21,pan=.12,metal=.58)
  elif key=='crown':
   a.kick(0,.39,fall=48)
   a.noise(0,.11,.12,pitch=0)
   for i,f in enumerate((293.66,440,587.33,880)):
    a.bell(f,.19+i*.115,.95,.20,pan=(-1 if i%2 else 1)*.26,metal=.55)
   a.tone(146.83,.06,1.37,.14,decay=.84)
  elif key=='diamond':
   a.noise(0,.085,.095,pitch=1)
   for i,(f,t) in enumerate(((1174.7,.10),(1568,.18),(2349.3,.35),(1760,.52),(3135.9,.73))):
    a.bell(f,t,.55,.16,pan=[-.48,.42,-.18,.38,0][i],metal=.91)
   a.bell(587.33,.22,.99,.15,metal=.2)
  else:
   a.sweep(270,780,.03,.39,.14,pan=-.14)
   a.kick(.43,.29,fall=56)
   for i,f in enumerate((392,523.25,659.25)):
    a.bell(f,.49+i*.09,.79,.21,pan=[-.20,.22,0][i],metal=.54)
   a.bell(1046.5,1.02,.64,.17,pan=.06)
   a.tone(196,.52,1.10,.12,decay=.69)
 samples,peak,rms=a.master()
 return samples,peak,rms

def main():
 import argparse
 parser=argparse.ArgumentParser()
 parser.add_argument('--verify-only',action='store_true')
 args=parser.parse_args()
 OUT.mkdir(parents=True,exist_ok=True)
 manifest=[]
 for i,(role,key,name,description,dur) in enumerate(BANK):
  filename=f'{role}-{key}.mp3'
  dst=OUT/filename
  if not args.verify_only:
   pcm,peak,rms=render(role,key,dur)
   with tempfile.NamedTemporaryFile(suffix='.wav',delete=False) as temp:
    temp_path=Path(temp.name)
   try:
    with wave.open(str(temp_path),'wb') as w:
     w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes(pcm.tobytes())
    cp=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-loglevel','error','-y','-i',str(temp_path),
                       '-codec:a','libmp3lame','-b:a','192k','-ar','48000','-ac','2',str(dst)],
                       capture_output=True,text=True,timeout=40)
    if cp.returncode:raise RuntimeError(cp.stderr[-750:])
   finally:temp_path.unlink(missing_ok=True)
  assert dst.stat().st_size>10000,filename
  cp=subprocess.run(['ffprobe','-v','quiet','-show_entries','format=duration:stream=channels,sample_rate',
     '-of','json',str(dst)],capture_output=True,text=True,timeout=20)
  if cp.returncode:raise RuntimeError(cp.stderr)
  meta=json.loads(cp.stdout);stream=meta['streams'][0]
  assert stream['channels']==2 and int(stream['sample_rate'])==48000
  got=float(meta['format']['duration'])
  assert abs(got-dur)<.16,(filename,got,dur)
  manifest.append({'role':role,'id':f'{role}-{key}','label':name,'description':description,
    'src':f'/audio/ranking-studio-v1/{filename}','duration':got,'bytes':dst.stat().st_size,
    'sha256':hashlib.sha256(dst.read_bytes()).hexdigest(),
    **({} if args.verify_only else {'peak':round(peak,3),'rms':round(rms,3)})})
 (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
 print('ORIGINAL_STUDIO_EARCONS',len(manifest))
 print('ROLES',{role:sum(item['role']==role for item in manifest) for role in ('rise','fall','top3')})
 print('ALL_BYTES',sum(item['bytes'] for item in manifest))
 for x in manifest:print(x['id'],round(x['duration'],2),x['bytes'],x.get('peak'),x.get('rms'),x['sha256'][:12])
if __name__=='__main__':main()
