#!/usr/bin/env python3
"""Generate the audit-backed PENGU LONG initial-negative research summary."""
import json
from pathlib import Path
repo=Path(__file__).resolve().parents[2]
dir=repo/'docs/research/results/pengu-initial-negative-20261024'
a=json.loads((dir/'PENGU_INITIAL_NEGATIVE_FULL8_AUDIT_20261024.json').read_text('utf8'))
j=json.loads((dir/'PENGU_INITIAL_NORMAL_RECOVERY_FULL8_COMBINED_AUDIT_20261024.json').read_text('utf8'))
base=a['baselineByCost']
base_10=base['10'];base_30=base['30']
fmt=lambda x:f'{round(x):,}'
diff=lambda x:('+' if x>=0 else '−')+fmt(abs(x))
def baseline(cost):
 x=base[cost];return x['finalEquityJpy'],x['maxDrawdownPct'],x['portfolioTrades']
def read(name,cost):
 if name in a['cases']:
  x=a['cases'][name][cost]
  return x['finalEquityJpy'],x['maxDrawdownPct'],x['portfolioTrades'],x['deltaVsLongProfit2BaseJpy']
 x=j['cases'][name][cost]
 return x['finalEquityJpy'],x['ddPct'],x['closedTrades'],x['deltaFromProfit2Baseline']
labels={
'AT8_NEG5_MFE1':'通常LONG 8h -5%（通常6h待機）',
'ARM35_WATCH2_MFE1':'通常LONG -3.5%監視2h（通常6h待機）',
'TOUCH5_AFTER2_MFE1':'通常LONG 2h以降、-5%タッチ（通常6h待機）',
'AT12_NEG4_MFE1':'通常LONG 12h -4%（通常6h待機）',
'AT8_NEG5_HARD24H_PROXY':'通常LONG 8h -5% ＋24h/60h保護',
'ARM35_WATCH2_HARD24H_PROXY':'通常LONG -3.5%監視2h ＋24h/60h保護',
'AT12_NEG4_HARD24H_PROXY':'通常LONG 12h -4% ＋24h/60h保護',
'RECOVERY24':'Recovery V8 24h -3%のみ',
'COMBINED8':'通常LONG 8h -5% ＋ Recovery 24h -3%',
'COMBINED':'通常LONG 12h -4% ＋ Recovery 24h -3%'
}
lines=[
'# PENGU LONG 初期逆行STOP｜SHORT採用条件を維持した最終統合研究（2026-10-24）',
'',
'**STATUS: RESEARCH_ONLY / NOT_DEPLOYED / INDEPENDENT_OOS_NOT_PROVEN / VENUE_UNVERIFIED**',
'',
'## 正本および不変条件',
'- 2025-08-10から2026-08-10までの因果研究モデル、8ロジック共有財布、AVAX承認済み6条件、各モデル3パス再選択、10bps主・30bpsストレス、会計PASS。',
'- SHORT V20のユーザー採用済み3h -2.5% / 8h -4%を維持。通常LONGの利益反転 MFE+2% 後に価格 -5% は先行研究の有力候補を引き継ぐ（ユーザーがLIVE正式採用を承認したとは主張しない）。',
'- 通常LONG -8% hard STOP と Recovery V8 -6% hard STOP は変更なし。Recovery入口・既存EXIT・Gross・クールダウンの既存正本は維持。',
'- 初期マイナス候補：通常LONGで最大MFE +1%未満を確認した後、指定の確定5分足終値で各時間・損失ゲートを評価。閾値で必ず約定できるという前提にはしない。',
'',
'## モデル再計算（円、全口座MTM最大DD、元の取引頻度）',
'',
'差額はSHORT2段階と通常LONG利益反転 +2%後-5% を含む基準との差。初期逆行をまだ追加していない基準は10bps '+fmt(base_10['finalEquityJpy'])+'円 / DD '+f"{base_10['maxDrawdownPct']:.5f}%"+' / '+str(base_10['portfolioTrades'])+'件、30bps '+fmt(base_30['finalEquityJpy'])+'円 / DD '+f"{base_30['maxDrawdownPct']:.5f}%"+' / '+str(base_30['portfolioTrades'])+'件。',
'',
'| ケース | 10bps最終資産 | 10bps基準差 | 10bps DD | 10bps件数 | 30bps最終資産 | 30bps基準差 | 30bps DD | 30bps件数 |',
'|---|---:|---:|---:|---:|---:|---:|---:|---:|'
]
for name,label in labels.items():
 x,xd,xn,xdelta=read(name,'10');y,yd,yn,ydelta=read(name,'30')
 lines.append(f'| {label} | {fmt(x)} | {diff(xdelta)} | {xd:.5f}% | {xn} | {fmt(y)} | {diff(ydelta)} | {yd:.5f}% | {yn} |')
lines.extend([
'',
'## 原因分解：損切りだけを追加するとDDが悪化する',
'- 普通6時間のPENGU cooldownとして初期LONGを早期決済すると、2025-11-09に新しい負けSHORTが採択され、従来のV12 SHORT採択が一部消える。これが再配分後の減益・DD悪化につながる。',
'- 凍結研究エンジンはHARD_STOPを含む終了理由に限り PENGU全体24h cooldown＋同一ルート60h隔離、他は6h cooldown。',
'- 24h/60h保護比較はモデル専用で出口理由にHARD_STOPという文字列を付けたプロキシ（本物のvenue hard STOPではない）。Productionでは型付き INITIAL_ADVERSE_RISK_EXIT と明示的24h/60h保護、注文競合と再起動復元を実装すべきであり、文字列偽装を持ち込んではならない。',
'',
'## 個別損失イベントと勝ちへの影響',
'- 通常LONG：2025-11-07 23:00 UTCの元最大MFE約+0.76%／旧-8% hard STOP取引が主な対象。M5モデル8h後-5%は約-5.18%、12h後-4%は約-4.27%決済。',
'- Recovery V8：2025-12-30 16:00 UTCの元最大MFE約+0.66%／旧-6% hard STOP取引。Recovery専用24h後-3%で約-3.24%決済。既存の勝ちを切った件数は0。',
'- 各ケースで採用済みSHORT二件の具体的決済時刻・数量・価格は変えない。元の通常LONG利益反転二件も維持。シグナル再選択と共通財布資金再配分は実際に再計算。',
'',
'## 研究推奨（採用前の条件）',
'- **取引件数を減らさない条件が最優先**：通常LONGの「8h時点、MFE<1%で-5%以下、24h全体待機＋60hルート隔離」＋ Recovery V8「24h時点、MFE<1%で-3%以下」の組合せを第一 Forward Shadow 候補にする。',
'- **収益最大化重視**：通常LONGの12h -4%＋24h/60h保護とRecoveryの24h -3%の組合せは最終資産がより高いが、全体取引数が10bps/30bps双方で減少するため、件数非減少方針では優先採用しない。',
'- 一律の単純時間STOPや継続監視のみ（通常6h待機）はDDが悪化するため不採用。',
'',
'## 未認証／運用注意',
'- 対象となる履歴初期逆行損失が各LONGルート1件で、候補570条件を同期間で探索した。過学習・選択バイアスが大きい。未使用期間OOSと独立フォワードShadowが必要。',
'- H1モデルエントリー価格とM5の比例補正を使うため、現実の約定価格・時刻と同一ではない。取引所実際の約定、venue常設STOP ACK、reduce-only、部分約定、EXIT競合、restart recovery、スリッページ・funding・margin・本番SHA照合は未検証。',
'- 最新V52の抑制済み候補を全て再生成したことは証明できず、LIVE利益・DD再現は未保証。Shared Risk/Rate Budget/Kill Switchの緩和は行わず本番注文も一切発行していない。',
'- 本研究の採用決定・Production/LIVE切替は未実施。',
'',
'## 再現コードと証拠',
'- scripts/dd-reduction/research-pengu-initial-negative-screen-20261024.py',
'- scripts/dd-reduction/research-pengu-initial-negative-native-full8-20261024.py',
'- scripts/dd-reduction/research-pengu-initial-negative-hardstop-cooldown-proxy-20261024.py',
'- scripts/dd-reduction/research-pengu-recovery-initial-native-full8-20261024.py',
'- scripts/dd-reduction/research-pengu-combined-initial-risk-native-full8-20261024.py',
'- scripts/dd-reduction/research-pengu-combined-normal8-recovery24-full8-20261024.py',
'- scripts/dd-reduction/audit-pengu-initial-negative-full8-20261024.py',
'- scripts/dd-reduction/audit-pengu-long-recovery-combined-full8-20261024.py',
'- docs/research/results/pengu-initial-negative-20261024/PENGU_INITIAL_NEGATIVE_FULL8_AUDIT_20261024.json',
'- docs/research/results/pengu-initial-negative-20261024/PENGU_INITIAL_NORMAL_RECOVERY_FULL8_COMBINED_AUDIT_20261024.json',
'',
])
test8=j['cases']['COMBINED8']
assert test8['10']['closedTrades']>=base_10['portfolioTrades'] and test8['30']['closedTrades']>=base_30['portfolioTrades'],'FIRST_FORWARD_SHADOW_CANDIDATE_TRADE_COUNT_GATE_FAILED'
assert test8['10']['ddPct']>=base_10['maxDrawdownPct']-1e-8 and test8['30']['ddPct']>=base_30['maxDrawdownPct']-1e-8,'FIRST_FORWARD_SHADOW_CANDIDATE_DD_GATE_FAILED'
out=dir/'PENGU_LONG_INITIAL_NEGATIVE_FINAL_DECISION_20261024.md'
out.write_text('\n'.join(lines).rstrip()+'\n',encoding='utf8',newline='\n')
print('REPORT_CREATED',out,'bytes',out.stat().st_size)
