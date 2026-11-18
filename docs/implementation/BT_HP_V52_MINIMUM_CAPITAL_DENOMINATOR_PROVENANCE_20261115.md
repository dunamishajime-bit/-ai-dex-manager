# PR #481 — V52日次リスク損失率の分母をNative研究ソースから再現（2026-11-15）

## 判定

**`MODEL_V52_MINCAP_SOURCE_EXPLAINED_ECONOMIC_PARITY_UNCERTIFIED`**。前段の監査で極端に見えたV52の日次損失率（最大25,557%）について、集計CSVだけでなく、元研究の生成済み経済ロジック `DIRECTION_RESEARCH_20261109/STABLE3_REPRO_RECOVERED_20261113/canonical_generated_sim_ON_20261113.py` を追跡した。ファイルのSHA256は **`e96d9cdb199e7d1e40f91b13a42569a3a6a83f22729d840c5da0e5bb577d932e`**。これは過去研究ソースの出自であり、2026-11-15時点のV52 LIVE execution SHAとは限らない。

### コード上のV52資本算式（研究用）

```python
_mincap = 10000.0 * 5.0 / 62.50520405  # 799.933...円
_reserve = max(_mincap, 0.10 * eq_v52)
_capital = max(_mincap, eq_v52 - _v96_notional - _reserve)
_loss = max(0.0, -(V52の当日実現損益 + V52保有の未実現損益))
_loss_pct = 100 * _loss / _capital
```

`_v96_notional` は **V52自身ではない、BTC/ETH/BNB/SOL/LINK/AVAX/DOGE/INJ/XRP/ADA/LTC/ATOM/AAVE/NEAR/PENGU の既存建玉時価評価Notionalの合計**。資本コストや残高を差し引くだけでなく、*他戦略が保有するGross Notional全体*を足し引く。したがってCrypto Grossが口座純資産を越えれば、V52に割り当てられる残余が負になることがある。このとき約800円の固定下限に丸めるため損失率が極端に増幅される。単純な計算間違いではなく、**研究モデルの資本配賦定義に由来**する。

| V52日次リスク検算 | 10bps | 30bps |
| --- | ---: | ---: |
| 元TRIPイベント | 122 | 124 |
| 研究の最低資本約799.93円が分母 | **81** | **83** |
| 同じ時点の独立Positions Grossから最低資本へのclampを再現 | **81/81** | **83/83** |
| 下限分母かつ損失率1,000%超のイベント | **66** | **67** |

### 最大モデル損失率の源泉（2026-05-15 00:00 UTC）

| 指標 | 10bps | 30bps |
| --- | ---: | ---: |
| 当時の全口座MTM Equity | ¥1,230,204 | ¥650,588 |
| PENGU・Q102など他戦略のV52隔離対象Notional | ¥2,202,642 | ¥1,166,499 |
| 対象Notional／口座Equity | 1.7905x | 1.7930x |
| 割当残余のclamp前モデル値 | **−¥1,095,458** | **−¥580,970** |
| clampした実際の研究用V52分母 | **¥799.93** | **¥799.93** |
| 研究ログに記録されたV52損失率 | **25,557.49%** | **14,294.29%** |

元研究用positions sourceの時価評価と、エントリー時点でのCompleted H1 Markは一部一致しない可能性がある。この監査では、**下限clampが選ばれた81/83イベントのみ一致保証**し、残りの非clamp41/41について、独立5分時価資料とソースH1の数値完全一致を宣言しない。

## 判断と次のタスク

**本番でリスクGateを変更しない。** この研究モデルのV52専用資本配賦は極端に厳しくなる場合があるため、実際のV52専用レバリッジ／資金分離設計と、`eq − 他戦略Gross Notional` が意図された運用かを設計者・Source pin双方から確認する必要がある。形式だけが合っていても、将来資本配分の経済合理性が証明されたわけではない。修正案を検証する際は、固定先行期間・独立Forward・Profit/VaR/MaxDD・同時エントリー/出口・約定実行コストを再計算し、現行LIVEルールの無断変更は行わない。

## 検証実装

- `scripts/bt_hp_v52_risk_capital_source_provenance.py`：研究ソース式と対象シンボルのAST/文字列固定検証、対象年V52 TRIP計246件を研究用Positions Grossの同じ時刻と照合。下限イベント164件すべて一致。
- `tests/test_bt_hp_v52_risk_capital_source_provenance.py`：8合成テスト、独立研究値・算式改変・対象シンボル追加の拒否。全BT Python検証 **225件PASS**。
- Private JSON：`C:\tmp\bt481-v52-model-capital-source-provenance-20261115.json`、SHA256 **`B715E8BEAF774A639F0D88112C8C53D830BC8FDFE38EE17FBA11482A24ECA581`**。

Production Runner・Order・STOP・Kill Switch・owner認証・V4切替は変更していない。対象年2025/10/01〜2026/10/01の研究モデルには依然として新V4 source mismatchとDD20%超過の課題がある。