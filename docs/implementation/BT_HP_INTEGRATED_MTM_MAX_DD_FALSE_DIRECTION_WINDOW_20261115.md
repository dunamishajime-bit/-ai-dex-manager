# BT #481 — STABLE4統合BT最大DDの完全時点再照合と誤方向分析（2026-11-15）

## 判定

**`MODEL_WINDOW_RECONCILED_DIRECTION_LABELS_DESCRIPTIVE_ONLY`**。HYPE native TREND＋7研究戦略モデルの10bps/30bps複利について、元研究equityの**105,121個の5分時点**を使用して最大DDのピークと谷を独立に探索。両費用ともピーク **2026-08-05 07:00 UTC**、谷 **2026-09-22 11:00 UTC**。Source summaryの`max_hourly_dd_pct`と全5分から再計算した最悪DDが一致。

| 最大DD区間 | 10bpsモデル | 30bpsモデル |
| --- | ---: | ---: |
| ピーク口座MTM評価額 | ¥9,534,683 | ¥4,116,680 |
| 谷の口座MTM評価額 | ¥5,698,041 | ¥2,989,914 |
| 口座MTM減少 | **−¥3,836,642** | **−¥1,126,766** |
| 最大DD | **−40.24%** | **−27.37%** |
| 現金残高変動 | −¥3,276,098 | −¥872,187 |
| 保有建玉の含み損益変動 | −¥560,544 | −¥254,579 |
| この区間に決済されたモデルFill | 59件 | 61件 |

**元台帳のCash＋全Openモデル建玉の時価評価PnL＝各ピーク/谷Equity** を全ポジションから直接再計算して一致。Cash増減とUnrealizedの差分合算もEquityの減少と一致。決済されたFillの損益はEntryをピーク以前にした取引を含み、Entry手数料とFunding支払時点の差分もあるため、**Fill別モデルNet PnLの合計をDDの厳密な戦略別因果寄与とは扱わない**。

## DD区間での決済ベース損益と方向誤判定

| ロジック（DDピーク→谷のモデル決済） | 10bps件数/勝ち/負け | 10bps 決済モデル純損益 | 30bps件数/勝ち/負け | 30bps 決済モデル純損益 |
| --- | --- | ---: | --- | ---: |
| Q102 | 13 / 3 / 10 | **−¥2,835,522** | 16 / 5 / 11 | **−¥1,255,569** |
| V4 | 20 / 8 / 12 | **−¥1,370,094** | 15 / 7 / 8 | −¥124,911 |
| HYPE | 6 / 1 / 5 | −¥368,382 | 6 / 1 / 5 | **−¥258,957** |
| IDLE | 7 / 5 / 2 | ＋¥31,757 | 8 / 5 / 3 | −¥230,623 |
| FET | 4 / 2 / 2 | ＋¥357,058 | 4 / 2 / 2 | ＋¥232,415 |
| PENGU | 3 / 2 / 1 | ＋¥390,742 | 4 / 3 / 1 | ＋¥542,317 |
| V52 | 6 / 5 / 1 | ＋¥513,145 | 8 / 7 / 1 | ＋¥217,921 |

Q102は10bpsで13件中10件が方向不利（LONGならexit値下落、SHORTならexit値上昇）、30bpsで16件中11件が方向不利。HYPE native TRENDも両費用で6件中5件方向不利。これは**モデルEntry/Exitの方向評価**で、レバ資金比・手数料・Fundingを含めた「モデルWin/Loss」と一致するとは限らない。

### 最も悪い研究Exit route（モデル、各区間）

- 10bps：V4 `REC_Y06_REV_D0_T72` 9件 **−¥1,023,790**、Q102 `FET|PB168_0.1_P24_0.02_H12` 1件 **−¥698,168**、Q102 HIGH_VOL ARB 1件 **−¥538,775**、SUI 1件 **−¥393,620**、ONDO 1件 **−¥362,611**。
- 30bps：Q102 FET PB168 1件 **−¥388,868**、HYPE TREND6件 **−¥258,957**、Q102 HIGH_VOL ARB1件 **−¥229,581**、SUI1件 **−¥212,728**。V4 Y06は30bpsでは総合影響が10bpsより軽い。

**上記のマイナスだけを基準に入口ルールを停止・最適化しない。** これらはMax DDという`結果が悪い期間`を後から選んだ同一年度サンプル。対象年前の訓練/検証、対象年後の独立Forward、非IID Episode、同時候補の機会費用を分離し、改善候補を固定してから両コスト10/30bps＋Funding/STOP/GrossのモデルBTを再計算する。

## 再現と証拠

- `scripts/bt_hp_integrated_mtm_dd_window_attribution.py`：対象年全5分資産推移、最大DDピーク/谷、元SourcePositionSnapshotsからUnrealized PnL、各Fill net＝gross−fees＋funding、方向不利Long/Short、コスト別Route損益をクロスチェック。
- `tests/test_bt_hp_integrated_mtm_dd_window_attribution.py`：9合成検証、価格方向の取り違え・Net損益・Source受渡期間の不整合を拒否。Python全BT **234件PASS**。
- Private監査JSON：`C:\tmp\bt481-integrated-maxdd-window-model-attribution-20261115.json`、SHA256 **`6CDE35935F700202A06A7488D5BB88EA48CCDE86F6D3E3E668A96D06CB3AF162`**。

この元BTは古いV4 source・現行HYPEとは別歴史ルートなどのProduction差分がある。新V4のLIVE経済と厳密一致していないため、**勝率/DD20%の改善案を本番へ採用していない**。本番注文・STOP・Kill Switch・承認・V4切替への変更なし。