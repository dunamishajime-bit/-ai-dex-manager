# BT #481 — Q102 AVAX/UNI Structured・Online ShadowのForward証拠再検算（2026-11-15）

## 判定

**`AVAX_UNI_PRETARGET_FORWARD_MIXED_ONLINE_UNCONFIRMED_NO_PRODUCTION_GATE`**。ユーザー指定のQ102 AVAX MR24／UNI MR72について、単に現行入口を除外するのではなく、方向SHORT/LONGの組み合わせを伴うStructured Redesign研究と、時点以前条件のOnline regime Shadowを独立に点検した。研究勝者を対象年・Forwardの成績を見て後から変更しない。

### Structured Redesign（固定Pretarget候補、Forwardは反証用）

| 銘柄 | Pretarget内で条件を満たした固定候補 | Forwardの平均モデルReturnがプラス | マイナス |
| --- | ---: | ---: | ---: |
| AVAXUSDT | 3 | 2 | 1 |
| UNIUSDT | 9 | 5 | 4 |

データのsource splitCountは `DEV_TRAIN=1455`・`DEV_VALID=728`・`DEV_HOLD=736`・`FORWARD=302`。これは各銘柄の研究対象バー/元行スコープであり、上表の候補ルールを個別に適用した**Fill件数とは異なる**。

- AVAX最上位の固定 `REV_LONG` はForward10件・勝率30.0%・PF0.354・平均約−1.46%。他の二つの固定 `EXHAUST_SHORT` はそれぞれForward6件で勝率100%となるが、同一条件の重複候補である可能性があり、2つの独立成功ではない。小標本6勝を本番高勝率認証には使わない。
- UNI最上位の `EXHAUST_SHORT` はForward5件・勝率40%・PF1.196。他の候補にはForwardで正負両方あり、9候補の中からForward成績で選び直すと選択バイアスを生む。

### Online Regime Shadow

- AVAXUSDT：Pretarget qualifying **3候補**。3候補とも`TARGET30`の平均モデルreturnは**負**、PFはそれぞれ0.525、0.561、0.755。独立Forwardで正式採用とする根拠はない。
- UNIUSDT：Pretarget qualifying **0候補**。これを対象年の成績だけで緩め、Gate合格にする行為は禁止。
- fast実装と基準実装の比較：AVAXではモデル内数値459セルに浮動小数の計算順序由来の差があるが、最大絶対差 **6.66×10⁻¹⁵**（許容1×10⁻¹²）で、その他の構造・決定変数・順序は一致。これはbyte-identicalの主張とは異なる。UNIは一致。閾値を越す数値・方向・行数差はfail closed。

## 再現方法

- `scripts/bt_hp_q102_avax_uni_forward_evidence_audit.py`：Structured固定Pretarget3/9、各DEV splitの算術一致、FORWARD outcomeが選抜へ混入しないこと、Online3/0のモデル母集団、TARGET悪化の明示、fast/基準の浮動小数許容内一致を照合。
- `tests/test_bt_hp_q102_avax_uni_forward_evidence_audit.py`：9テスト。Forward選抜・Fast計算実質乖離・偽のターゲット改善・候補数ずれを拒否。BT Pythonテスト累計**194件PASS**。
- Owner PC Private監査結果：`C:\tmp\bt481-q102-avax-uni-forward-evidence-20261115.json`。SHA256 `2F63A267618D4B941DC66252DA797BB8D7737391E0DD08E6A4189DB9C9FB8E2B`。
- 元研究資料は `q102_avax_uni_structured_redesign_v4_20261113.json`・`q102_avax_uni_online_regime_shadow_v4_20261113.json`・`q102_avax_uni_online_regime_shadow_v4_fast_20261113.json`。

## 次のGate

Q102 AVAX/UNIの再設計はまだ研究段階であり、現行本番MR24/MR72のsource pin/出口実装との全件一致、事前登録した独立期間のForward、価格データの信頼性、DD20%・勝率向上の両コスト統合BTまでは未成立。結果に基づく現行Gate停止・閾値変更・LIVE稼働変更は行わない。V4切替はCodex担当、PR #481 Draft、注文/STOP変更0件。