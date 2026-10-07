from pathlib import Path
import json, math, hashlib, collections, datetime, gzip
r=Path(r'C:\Users\dis\DisDex-five-improvements-20261008')
b=r/'docs/research/results/all-gates-opportunity-20261008'
cases=[json.loads(p.read_text(encoding='utf-8')) for p in sorted((b/'gate-cases').glob('*.json'))]
assert len(cases)==38,len(cases)
for c in cases:
 assert c['raw_candidate_count']==len(c['annual_candidates'])
 for m in c['metrics']:
  rs=[t['unit_gross_return']-m['cost_bps']/10000 for t in c['trades']]
  assert len(rs)==m['trades']
  if rs:
   assert abs(sum(x>0 for x in rs)/len(rs)-m['win_rate'])<1e-12
   assert abs(sum(rs)/len(rs)-m['mean_net_return'])<1e-12
   losses=-sum(x for x in rs if x<0)
   if losses:assert abs(sum(x for x in rs if x>0)/losses-m['pf'])<1e-10
 for x in c['yesterday_candidates']:
  assert 1791298800000<=x['entry_ts_ms']<1791385200000
j=json.loads((b/'live-day-journal.json').read_text(encoding='utf-8'))
rows=j['rows']
for x in rows:assert 1791298800000000<=int(x['observed_ts_us'])<1791385200000000
holds=[x for x in rows if 'FULL_1X_NOT_REALIZABLE' in str(x['data'])]
def jt(ms):return datetime.datetime.fromtimestamp(ms/1000,datetime.timezone(datetime.timedelta(hours=9))).isoformat()
blocks=collections.defaultdict(list)
for x in holds:
 d=x['data'];key=(d.get('strategyId'),d.get('symbol'),int(x['observed_ts_us'])//3600000000)
 blocks[str(key)].append(d.get('timestamp'))
pg={x['data']['signal']['referenceTs']:x['data']['signal']['features'] for x in rows if 'pengu' in x['unit'] and 'signal' in x['data'] and 'features' in x['data']['signal']}
a={'schema':'all-gates-audit/v1','window':{'start_jst':'2026-10-07T00:00:00+09:00','end_jst_exclusive':'2026-10-08T00:00:00+09:00'},'verified_cases':len(cases),'verified_cost_summaries':sum(len(c['metrics']) for c in cases),'live_json_rows':len(rows),'quantity_rounding_hold_rows':len(holds),'quantity_rounding_symbol_strategy_hour_groups':blocks,'pengu_unique_hourly_features':len(pg),'pengu_btc_short_gate_pass_hours':sum(f['btcReturn24h']<=.04 and f['btcEma168Distance']>=-.04 for f in pg.values()),'live_stats':j['stats'],'variants':[{'strategy':c['strategy'],'name':c['name'],'annual_offered_candidates':c['raw_candidate_count'],'yesterday_offered_candidates':len(c['yesterday_candidates']),'isolated_metrics':c['metrics'][0]} for c in cases]}
(b/'validated-audit.json').write_text(json.dumps(a,ensure_ascii=False,indent=2),encoding='utf-8')
table=[]
for c in cases:
 m=c['metrics'][0];table.append('| '+ ' | '.join([c['strategy'],c['name'],str(c['raw_candidate_count']),str(len(c['yesterday_candidates'])),str(m['trades']),f"{m['win_rate']*100:.2f}%" if m['win_rate'] is not None else '-',f"{m['pf']:.3f}" if m['pf'] is not None else '-'])+' |')
report="""# 全ロジック Gate／取引機会の再検証（2026-10-08）
対象は「昨日」2026-10-07 JSTの24時間。UTCでは2026-10-06 15:00以上、2026-10-07 15:00未満。

## 結論
昨日の全体無発火を「BTC Gateが厳しすぎる」とまとめる根拠はない。BTC条件を緩めるだけでは、V12・PENGU・Idle DOTの昨日の候補数は増えなかった。一方、Idleには既存条件を通過した候補があり、発注数量丸めによる1x未達判定で止まった事実がある。取引機会を回収する優先対象はこの実行判定とBaseline状態の時刻整合性である。

LIVEのパラメータ／注文ロジックは今回変更していない。以下は監査と比較研究の結果であり、全体利益・DD改善が認証されたGate変更ではない。

## 全ロジックの判定
| ロジック | 昨日の確認 | 再判定・次の対応 |
|---|---|---|
| V12 | 現行0候補。BTC閾値2%→1.5%・1%・0%でも0。Score、出来高、ATRの単独緩和および限定併用も0 | NEUTRALを禁止する設計ではなくScore等で許可。BTCの一括緩和を採用する根拠なし。ExitのLIVE／参考BT差異を先に解消 |
| PENGU | 24個の独立時刻すべてでSHORT用BTC条件通過。現行・8緩和案とも昨日0候補 | 基本セットアップ不成立。BTC緩和よりM05 Forward Shadow継続 |
| Q102 | REV LONGの14日リターン24%以上条件で3回停止。条件撤去ではFET LONGが10:00・18:00・22:00 JSTに提示 | BTC Gateではない。撤去は単体比較で勝率/PF悪化。20%への軽い緩和でも昨日候補は増えず。HIGH_VOL SHORT 0.60xは維持 |
| FET BRK48 | 基本Breakout不成立。出来高・72hリターン・時刻Gridの緩和も昨日0候補 | 方向BTC Gateなし。入口の一括緩和よりExit研究を優先 |
| HYPE trend H1 | 現行およびSlope・Breakout・EMA距離緩和でも昨日0候補 | 稼働ルートに方向BTC Gateなし。旧sidecarのBTC条件と混同しない |
| Idle SHORT／Residual LONG | 信号のみ再生で7／10候補時刻。ただし実注文可能数ではない。JUP SHORTとAVAX LONGが数量丸めで停止 | 数量判定、Baseline時刻整合、Margin Guard状態を分離して修正・検証 |
| V52 | 市場閉鎖、Basis/Net Edge不足、Reference stale等 | 方向BTC Gateなし。参照価格の鮮度と営業時間が支配的 |

## 実行Gateの具体的な問題
Idle SHORTおよびResidual LONGは、数量を取引所lot stepで切り下げた後、notional/equity < 1-1e-6なら停止する。許容される1x不足はわずか0.0001%であり、通常の数量切り下げでも超え得る。
ソースはlib/idle-priority-short-runner.tsとlib/idle-residual-long-runner.ts。昨日の該当ログは41回で、同じ候補の再試行を含むため41トレードとは数えない。strategy・symbol・UTC時間でまとめた6群をvalidated-audit.jsonに保存。

修正設計は「不足を任意の割合で許す」ではなく、要求数量に対する正しいlot step切り下げを確認し、実notionalでGrossと予約を整合させること。min notional、capacity、quote freshness、margin確認は維持する。この変更は次の実装修正対象であり、今回の監査では未適用。

Baseline timestamp staleの保持も多数ある。V12の2H判定とIdleのH1判定／短い鮮度要求が関係する可能性があるが、昨日の各時点の全Baseline snapshotは保存されておらず、原因を一律に確定できない。単純に鮮度上限を緩めず、as-of時点の判定証明と更新周期を合わせる必要がある。lock busy、rate budget、Margin Guard不健全も独立原因であり、無効化しない。

## 単体比較で見えたこと
PENGU BTC EMA168距離下限 -4%→-6%は年間候補113→115、単体勝率74.63%→73.53%、PF4.073→3.745。RecoveryのBTC6h最低値を0へ緩めると候補123となるが勝率72.06%、PF3.528。いずれも昨日は0のまま。
Q102 REV LONG条件撤去はS34候補267→301、昨日3候補を追加。ただし単体勝率64.18%→60.40%、PF2.423→1.932。後半でもPF2.025→1.587。候補を増やすための即採用は支持しない。
Idle DOTのBTC24h上限0%→+1%は候補694→709だが昨日7のまま。単体PF1.186→1.073。BTC緩和を優先する根拠は弱い。

## V12参考BTとの実行差異
LIVEは新Trailing Stopがすでに現在価格を越えた場合、現在quoteで即時Exitする。既存の参考候補台帳では、該当状況に新Stop価格でExitした例がある。
例：ADA LONG、entry_ts_ms=1754798400000、entry=0.8216。完成2Hで更新したStopを越えた次H1 openの代理quoteは0.8137（約-0.962%）。既存台帳のExitは0.8314967741935484（約+1.205%）。
H1 openは実際のbid/askを復元するものではないが、Stop価格での有利な約定を仮定できないことは確認できる。V12の比較損益、従来の全体複利損益・DDはこの差を解消した再計算が必要。今回の単体DDを現行全体DDとして扱わない。

## 方法と限界
現在ソースのpure signal/configを直接読み、年間H1データと昨日の公開H1を時間順に再判定。年次データは2025-08-10〜2026-08-10、銘柄ごとの欠損・開始時期は異なる。昨日用は追加公開データと稼働保存データを使用。年間と昨日は連続した同一検証期間ではない。
年間候補は時刻ごとに提示されたsignal数であり、独立実約定数ではない。単体損益はH1モデル・1トレードの総コスト10/20/30bps控除を使う参考比較で、funding、実スプレッド、全体Gross制約、他ロジック優先、Idle admission/preemption、V12の完全なrotationを再現しない。Q102再生成はS34系でありHIGH_VOL全件の学習・選択競合を再生成していない。V52はLIVE診断監査でありこの38ケースの価格BT対象外。
serial_realized_ddは単体の決済順unit equityであり、全体の含み損込みDDとは異なる。以下の勝率/PFも実運用期待値やGate採用証明ではない。特にV12は上記Exit差があるため機会数の参考に限定する。
全38ケース、114コスト集計を再実行し、保存tradeから勝率・PF・平均損益を独立再計算して一致を検証。昨日candidateとjournalの時間範囲も確認。

## 全38ケース（10bps参考）
| Logic | Variant | 年間提示候補 | 昨日提示候補 | 単体trade | 単体勝率 | 単体PF |
|---|---|---:|---:|---:|---:|---:|
"""+"\n".join(table)+"""
## 保存物と再実行
scripts/research/all_gate_ablation.cjs が比較再生、scripts/research/validate_all_gates.py が集計検証。
Windows worktreeでnode scripts/research/all_gate_ablation.cjs、python scripts/research/validate_all_gates.pyを実行。ソース入口hashはentry-source-manifest.json、全入力・結果のhashはartifact-manifest.json。
本番へのGate緩和は未実施。次の順序は数量丸め修正→Baseline時刻整合の原因分解→V12 Exit parity再BT→Q102等の限定Shadow比較。
"""
(b/'README.md').write_text(report,encoding='utf-8')
manifest=[]
for p in sorted(b.rglob('*')):
 if p.is_file() and p.name!='artifact-manifest.json':manifest.append({'path':str(p.relative_to(r)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(b/'artifact-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps({'verified_cases':len(cases),'cost_summaries':114,'journal_rows':len(rows),'rounding_rows':len(holds),'rounding_groups':len(blocks),'pengu_hours':len(pg),'files':len(manifest)},ensure_ascii=False))
