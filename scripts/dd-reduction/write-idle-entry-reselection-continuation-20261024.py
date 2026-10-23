#!/usr/bin/env python3
"""Auditable research-only continuation report from run-specific native full8 ledgers."""
from __future__ import annotations
import json
from pathlib import Path
REPO=Path(__file__).resolve().parents[2]
OUT=REPO/'docs/research/results/idle-entry-three-20261024'
data=json.loads((OUT/'IDLE_RENDER_DOT_JUP_LATEST_FULL8_ENTRY_AUDIT_20261024.json').read_text('utf8'))
ranking=json.loads((OUT/'IDLE_RENDER_DOT_JUP_FROZEN_TRAIN_CAUSAL_RISK_RANK_20261024.json').read_text('utf8'))
cases=data['testedCases'];baseline=data['baselineByCost']
NAMES={
 'JUP_RET12GE_M5':'JUP 12h >= -5% 単独',
 'RENDER_ATR3LE_0P8':'RENDER ATR3h <=0.8% 単独',
 'DOT_RET1GE_M1':'DOT 1h >= -1% 単独',
 'COMBO_KEEP90':'前回3通貨併用 BTC3h/JUP12h/DOT1h',
 'COMBO_ATR_DOT_JUP':'今回3通貨併用 RENDER ATR/JUP12h/DOT1h',
 'COMBO_ATR_JUP_ONLY':'RENDER ATR/JUP12h、DOT変更なし',
 'COMBO_BTC_ATR_JUP_ONLY':'RENDER BTC+ATR/JUP12h、DOT変更なし',
 'COMBO_BTC_DOT_JUP3_GE_M1P5':'BTC3h/DOT1h/JUP12h+JUP3h >= -1.5%',
 'COMBO_BTC_DOT_JUP3_GE_M1':'BTC3h/DOT1h/JUP12h+JUP3h >= -1%',
}
def n(x):return f'{x:,.0f}'
def signed(x):return ('+' if x>=0 else '−')+n(abs(x))
def wins(r,s):
 z=r['symbols'][s]
 return f'{z["wins"]}/{z["n"]}={z["wrPct"]:.1f}%' if z['wrPct'] is not None else 'NA'
def retention(r,s,c):
 a=r['symbols'][s]['n'];b=r['baselineSymbolSummary'][s]['n']
 return a/b if b else 0
for name in ('COMBO_ATR_DOT_JUP','COMBO_ATR_JUP_ONLY','COMBO_BTC_ATR_JUP_ONLY',
             'COMBO_BTC_DOT_JUP3_GE_M1P5','COMBO_BTC_DOT_JUP3_GE_M1'):
 assert name in cases and set(cases[name])=={'10','30'},('FULL8_NOT_COMPLETE',name)
for name,r in cases.items():
 for cost in ('10','30'):
  assert r[cost]['accounting']=='PASS'
start=[
 '# Idle RENDER / DOT / JUP SHORT：入口順位・資金再選択の継続検証（2026-10-24）',
 '',
 '**STATUS: RESEARCH_ONLY — Production, VPS, LIVE注文, HPは未変更。実venue・未使用OOS・Task9 TypeScript parityは未証明。**',
 '',
 '## 基準と検証設計',
 '- 検証期間2025-08-10〜2026-08-10。費用10bpsと30bps。同じAVAX/PENGU改善を保持した8ロジック共有財布・動的再選択3パス。',
 '- トレード単位の勝率を銘柄別・全体別で評価。全体件数維持でも銘柄の件数が減れば明記する。',
 '- 入口は確定済5m足の事前値しか参照せず、保護STOP・元ロジックGross・Shared Riskは変更しない。',
 '- 既に研究した同一期間への繰り返し調整による多重比較バイアスは残る。',
 '- 10bps基準資産 **'+n(baseline['10']['finalEquityJpy'])+'円**、最大DD '+f"{baseline['10']['ddPct']:.5f}"+'%、取引 '+str(baseline['10']['closedTrades'])+'件。',
 '- 30bps基準資産 **'+n(baseline['30']['finalEquityJpy'])+'円**、最大DD '+f"{baseline['30']['ddPct']:.5f}"+'%、取引 '+str(baseline['30']['closedTrades'])+'件。',
 '',
 '## 全8ロジック統合BT：候補を単独・併用で再選択',
 '| 研究条件 | 10bps資産 | 対基準差 | 全体取引数 | 30bps資産 | 対基準差 | 全体取引数 | 30bps DD |',
 '|---|---:|---:|---:|---:|---:|---:|---:|',
]
for name,title in NAMES.items():
 x=cases[name];a=x['10'];b=x['30']
 start.append('| '+title+' | '+n(a['finalEquityJpy'])+' | '+signed(a['deltaFromBaselineJpy'])
 +' | '+str(a['portfolioTrades'])+' | '+n(b['finalEquityJpy'])+' | '+signed(b['deltaFromBaselineJpy'])
 +' | '+str(b['portfolioTrades'])+' | '+f"{b['ddPct']:.5f}%"+' |')
start+=['',
 '## 3通貨の個別勝率と取引数',
 '| 研究条件 | RENDER 10bps | RENDER 30bps | DOT 10bps | DOT 30bps | JUP 10bps | JUP 30bps | 30bps全3通貨90%件数維持 |',
 '|---|---:|---:|---:|---:|---:|---:|---:|']
for name,title in NAMES.items():
 x=cases[name];a=x['10'];b=x['30']
 retained=all(retention(b,s,'30')>=.90 for s in ('RENDERUSDT','DOTUSDT','JUPUSDT'))
 start.append('| '+title+' | '+wins(a,'RENDERUSDT')+' | '+wins(b,'RENDERUSDT')
 +' | '+wins(a,'DOTUSDT')+' | '+wins(b,'DOTUSDT')+' | '+wins(a,'JUPUSDT')+' | '
 +wins(b,'JUPUSDT')+' | '+('YES' if retained else 'NO')+' |')
start+=['',
 '## 時系列固定スコアの診断',
 '- 2025-08-10〜2026-02-09の候補で10変数の弱い正則化付き入口判定を学習。24h前に決済したラベルだけを使用。2026-02-10以降は係数・閾値を一切再学習しない。',
 '- 学習サンプルは同一日の繰り返し候補に日単位の重みを付与。学習20%下位を拒否する基準を固定。後半も研究済みであり、これを独立OOSと称さない。',
 '| 通貨（30bps、後半） | 候補元勝率 | スコアによる選別後勝率 | 候補維持率 | 訓練独立日 |',
 '|---|---:|---:|---:|---:|']
for s in ('RENDERUSDT','DOTUSDT','JUPUSDT'):
 x=ranking['costs']['30']['symbols'][s];y=x['allRawCandidates']['later']
 start.append(f"| {s} | {y['all']['wrPct']}% | {y['admit']['wrPct']}% | {y['retainedPct']}% | {x['trainingDays']} |")
# MFE/MAE diagnosis from the same frozen native ledger, strictly EX POST.
paths=json.loads((OUT/'IDLE_RENDER_DOT_JUP_INITIAL_ADVERSE_ENTRY_PATH_20261024.json').read_text('utf8'))
start+=['','## 30bps RENDER/JUPの損失経路と直前の価格状態',
 '価格経路のMFE/MAE、EXIT理由は損益確定後にのみ利用できる資料で、入口発火条件には使用しない。',
 '| 銘柄 | 30bps負け件数 | 含益+1%未到達の負け | 直前3h騰落率：勝ち中央値 | 直前3h騰落率：負け中央値 |',
 '|---|---:|---:|---:|---:|']
for sym in ('RENDERUSDT','DOTUSDT','JUPUSDT'):
 x=paths['costs']['30']['symbols'][sym]
 start.append(f"| {sym} | {x['losers']['n']} | {x['initialNeverMfe1Count']} | "
  f"{x['winners']['medSym3h']}% | {x['losers']['medSym3h']}% |")
start+=['',
 'JUPの直近3hリターン >=−1%は旧採択7件から5件（勝ち4/5）、>=−1.5%は6件（4/6）。いずれも既存選択群の後付け選別。最新8ロジック全件再選択後の成績とは異なる。',
 '',
 '## 独立入口構造の否定的結果',
 '- 先行研究でRENDER/DOT/JUP×各12新入口パターンを確定5m足から全量生成。30bpsで70%勝率・十分な件数を維持する新入口は得られなかった。',
 '- RENDERのLOWVOL_BOUNCE_REJECTは30bps 93件/47.31%/PF1.392。JUP同型は84件/47.62%/PF1.16。DOTも低勝率。これらは最大損切10%、最大利確25%、各12/24時間保持の独立モデルで、現行Idle保護STOP/8ロジック資金制約と同等ではない。',
 '',
 '## 判定',
]
a=cases['COMBO_KEEP90']['30'];old=cases['COMBO_ATR_DOT_JUP']['30']
start.append('- BTC型3通貨併用とRENDER ATR型3通貨併用の30bps差：ATR型が'+signed(old['finalEquityJpy']-a['finalEquityJpy'])+'円、全体取引'+str(old['portfolioTradesDelta']-a['portfolioTradesDelta'])+'件差。単独で良好なATRでも他との併用で優れるとは限らない。')
start+=['- 30bpsで全体収益・DDが改善しても、RENDER・JUPの70%勝率は到達せず。勝率を重視した選別と発火タイミングの再設計が必要。',
 '- JUPの基準取引7-8件は特に小標本。スコア学習の日数も極めて小さく、実運用採択不可。',
 '- 原本の取引所約定、部分約定、再起動復元、入出金/資金調達、Pending/Margin、Production SHA、venue所有権の照合は未完了。',
 '- BT結果はモデル内でのみ成立する実験結果。**LIVEに配線しない**。',
 '',
 '## 資料',
 '- scripts/dd-reduction/run-idle-three-entry-native-full8-20261024.py',
 '- scripts/dd-reduction/audit-idle-entry-three-native-full8-20261024.py',
 '- scripts/dd-reduction/screen-idle-entry-forward-risk-ranking-20261024.py',
 '- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_DOT_JUP_LATEST_FULL8_ENTRY_AUDIT_20261024.json',
 '- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_DOT_JUP_FROZEN_TRAIN_CAUSAL_RISK_RANK_20261024.json',
]
file=OUT/'IDLE_ENTRY_RESELECTION_CONTINUATION_20261024.md'
file.write_text('\n'.join(start).rstrip()+'\n',encoding='utf8',newline='\n')
print('REPORT_SAVED',file,file.stat().st_size,'FULL8CASES',len(cases))
