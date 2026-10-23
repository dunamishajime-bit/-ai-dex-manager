#!/usr/bin/env python3
"""Create auditable summary from completed causal 8-strategy and independent M5 studies."""
import json
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
DIR=REPO/'docs/research/results/idle-entry-three-20261024'
AUDIT=json.loads((DIR/'IDLE_RENDER_DOT_JUP_LATEST_FULL8_ENTRY_AUDIT_20261024.json').read_text('utf8'))
B=AUDIT['baselineByCost'];C=AUDIT['testedCases']
M={
'RENDER_BTC3GE_M1P5':'RENDER BTC直近3h −1.5%以上',
'RENDER_BTC3GE_M1':'RENDER BTC直近3h −1%以上',
'RENDER_ATR3LE_0P8':'RENDER ATR3h 0.8%以下',
'DOT_RET1GE_M1':'DOT 直近1h −1%以上',
'DOT_LOWVOL_OVERSOLD_VETO':'DOT 6h売られすぎ×低出来高回避',
'JUP_RET12GE_M5':'JUP 直近12h −5%以上',
'COMBO_KEEP90':'併用:RENDER BTC3h/DOT1h/JUP12h',
'COMBO_BEST_WR':'併用:強めRENDER BTC3h/DOT6h/JUP12h'}
f=lambda x:f'{round(x):,}'
dp=lambda x:('+' if x>=0 else '−')+f(abs(x))
text=[
'# Idle RENDER / DOT / JUP SHORT：入口再設計と勝率・取引回数（2026-10-24）',
'',
'STATUS: RESEARCH_ONLY. 本番・注文・VPS・HPには一切変更していない。未使用OOS、実venue認証は未完。',
'',
'## 条件とベースライン',
'- 期間 2025-08-10〜2026-08-10、最初のJPY10,000、10bps主 / 30bpsストレス、AVAX、PENGU SHORT dualとLONG/Recovery初期逆行保護の研究候補を保持。',
'- 8ロジック動的共有財布、確定M5入口特徴のみで事前拒否、再選択3パス、モデル会計PASS。',
'- 基準 10bps JPY'+f(B['10']['finalEquityJpy'])+', 最大DD '+str(B['10']['ddPct'])+'%, 総件数'+str(B['10']['closedTrades'])+'。',
'- 基準 30bps JPY'+f(B['30']['finalEquityJpy'])+', 最大DD '+str(B['30']['ddPct'])+'%, 総件数'+str(B['30']['closedTrades'])+'。',
'- IDLE銘柄別基準：RENDER 10bps 15/24, 30bps 10/22；DOT 20/30（両コスト）；JUP 10bps 3/7, 30bps 4/8。',
'',
'## 最新累積8ロジックBTの経済結果',
'| ケース | 10bps 資産 | 増減 | 件数差 | RENDER勝率 | DOT勝率 | JUP勝率 | 30bps 資産 | 増減 | 件数差 | RENDER勝率 | DOT勝率 | JUP勝率 |',
'|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|'
]
for name,label in M.items():
 if name not in C:continue
 a=C[name]['10'];b=C[name]['30']
 def wr(r,s):
  k=r['symbols'][s]
  return f'{k["wins"]}/{k["n"]} ({k["wrPct"]:.1f}%)' if k['wrPct'] is not None else '—'
 text.append('| '+label+' | '+f(a['finalEquityJpy'])+' | '+dp(a['deltaFromBaselineJpy'])+' | '+str(a['portfolioTradesDelta'])+' | '+wr(a,'RENDERUSDT')+' | '+wr(a,'DOTUSDT')+' | '+wr(a,'JUPUSDT')+' | '+f(b['finalEquityJpy'])+' | '+dp(b['deltaFromBaselineJpy'])+' | '+str(b['portfolioTradesDelta'])+' | '+wr(b,'RENDERUSDT')+' | '+wr(b,'DOTUSDT')+' | '+wr(b,'JUPUSDT')+' |')
text+=['',
'全経済BTの最大DDは固定の元資産減少期間に支配され全ケース不変。ただしDD不変は最善を証明しない。',
'',
'## タイミング変更と候補数',
'- 実取引台帳の候補イベント：RENDER177件/採択24件、DOT141件/採択30件、JUP214件/採択7件（10bps）。未採択の多くは容量・クールダウン・既存ポジション・全1x必要など制約であり、直接LIVE注文許可できない。',
'- 早期SHORTエントリーを1h〜3h後の新発火へ遅らせると改善する事例も悪化する事例も存在。反発→失速・相対弱化の因果条件を確認すべきで、単に時間を置くことは不可。',
'- RENDERは30bpsで10勝/22取引。18件を残す単純VETOなら理論最大勝率は10/18=55.6%。取引件数を維持し70%を狙うには勝ちエントリー増加か再タイミングが不可欠。',
'- 旧M5探索窓2025-08-10〜2026-08-10は何度も検証済み。時系列後半は独立未使用OOSではない。',
'',
'## 新アーキテクチャ独立M5スクリーン',
]
research=DIR/'IDLE_NEW_SHORT_ENTRY_ARCHITECTURES_M5_SCREEN_20261024.json'
if research.exists():
 obj=json.loads(research.read_text('utf8'))
 for sym in ('RENDERUSDT','DOTUSDT','JUPUSDT'):
  vals=[]
  for name,v in obj['costResults']['30'][sym]['strategies'].items():
   p=v['overall'];l=v['earlier'];h=v['later']
   if p['n']>=15 and p['pf'] is not None and p['pf']>=1.0 and l['n']>=5 and h['n']>=5:
    vals.append((name,p,l,h))
  vals.sort(key=lambda x:(-x[1]['pf'],-x[1]['n']))
  text.append('- '+sym+'：非重複単独30bpsでPF>=1かつ15件以上を満たした12設計中の候補'+str(len(vals))+'件。')
  for name,p,l,h in vals[:3]:
   text.append('  - '+name+': N '+str(p['n'])+', WR '+str(p['wrPct'])+'%, PF '+str(p['pf'])+', 前半PF '+str(l['pf'])+', 後半PF '+str(h['pf'])+'.')
else:text.append('- 集計中につき未完了。新エントリーの8ロジック統合は未実施。')
text+=['',
'## 判断',
'- JUPの12h −5%制限は両コスト増益・全体回数非減少・JUP単体勝率上昇。ただし7〜8件で過学習リスク。Forward Shadow候補。',
'- DOTの1h −1%制限は20/28で71.4%へ上昇するが、30bps最終資産改善僅少。慎重に検証継続。',
'- RENDER ATR3h<=0.8%制限は10/30bpsの両方で口座資産増益だが、30bpsのRENDER勝率は47.6%に留まり、入口抜本的再設計が必要。',
'- 統合BT後に候補を足した場合、以前の独立結果を足し合わせてはいけない。共同8ロジックBTで再計算して採否決定。',
'- 取引数の厳格な比較は全体と銘柄単独の両方で行い、利益だけを見た複数閾値の過学習を許さない。',
'- venue注文ライフサイクル・型付き所有権・SL/TP競合・funding・スリッページ・動的gross一致・本番SHA照合は未認証。',
'- 研究のみ、LIVE変更なし。',
'',
'## 再現',
'- screen-idle-entry-families-after-pengu-20261024.py',
'- run-idle-three-entry-native-full8-20261024.py',
'- audit-idle-entry-three-native-full8-20261024.py',
'- test-idle-three-entry-causal-20261024.py',
'- screen-idle-new-short-entry-architectures-20261024.py',
]
target=DIR/'IDLE_RENDER_DOT_JUP_ENTRY_DECISION_20261024.md'
target.write_text('\n'.join(text).rstrip()+'\n',encoding='utf8',newline='\n')
print('REPORT_COMPLETE',target,target.stat().st_size,'all8_cases',len(C),'new_source_screen',research.exists())
