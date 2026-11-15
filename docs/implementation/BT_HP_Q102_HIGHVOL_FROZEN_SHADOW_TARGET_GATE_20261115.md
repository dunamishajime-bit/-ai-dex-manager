# PR #481 — Q102 HIGH_VOL Pretarget固定Online Gateの独立検証・採用見送り（2026-11-15）

## 結論

**`Q102_HIGHVOL_ONLINE_WORSENS_TARGET_18_AND_POSTTARGET_FORWARD_NOT_PROVEN`**。2025年前半〜9月のPretargetプロキシ市場データで事前固定した「90日Lookback／最少5件／PFが0.60未満なら新規入場拒否」のGateを、2025/10〜2026/10対象年の別モデルに一度だけ適用した元研究を再照合。結果として**勝率は改善ではなく悪化**。このGateを正式Q102 HIGH_VOLに採用しない。

| 元モデルコホート | Pretarget（30bpsモデル） | 対象年One-shot（30bpsモデル） |
| --- | ---: | ---: |
| Gateなし元候補 | 202件／勝率**49.01%**／PF1.127 | 18件／勝率**33.33%**／PF0.727 |
| 90d・min5・PF0.60固定Online Gate通過 | 138件／勝率**44.20%**／PF1.037 | 15件／勝率**20.00%**／PF0.0996 |
| Gate拒否後もシャドー追跡した候補 | 64件／勝率**59.38%**／PF1.305 | 3件／勝率**100.00%**（極小標本） |

対象年に拒否した3候補はすべて**ONDOUSDT**の同方向候補。結果判定後の情報でGateを救済して再チューニングしない。**Pre期でもGateに残った候補の方が敗けやすく、Targetでさらに悪化した**のが研究実態。

## 「19候補」「18候補」「統合モデル約定6/7件」は母集団が違う

- 別のNative signal auditで報告された**19件**は全native候補または取引所LIVEシグナルの再現集合を指すが、今回のShadow online研究元台帳のTarget baselineは**18件**。差分の一件が何であるかは候補ID単位で未照合。**同じ母集団と宣言しない**。
- STABLE4/HYPE nativeの7戦略統合ポートフォリオ実行モデルではQ102 `HIGH_VOL|...` の閉じた約定は10bps**6件（5敗）**、30bps**7件（5敗）**。これはGross・Slot・Shared Risk・優先順位で採用されるモデルEntryに限られ、18件の全候補とは一致しない。
- 2026-10-01以降の完全に未見の独立Forward市場でのQ102 HIGH_VOL候補・native STOP出口・actual venue Fillの検証は**未完了**。対象年の18件に勝った閾値を過去へ戻して再採用しない。

## 構造Gate研究も採用根拠が不足

- 事前定義の構造仮説4種類のうち、Pre期を通過したのは `PULLBACK_IN_14D_TREND` の1種類。ただしそのOne-shot対象年発火は**0件**で、勝率改善を示さない。
- 別のPretarget定量ルール150件の探索は**ロバスト条件の合格0件**、採用候補なし。後からThresholdを選び直してはいけない。
- 元ProxyとTargetのSource SHAペアは上記3研究で一致を監査済み。これは照合性であり、Native Q102ランナーのsource・order/post-fill一致ではない。

## 追加したコードとPrivate証跡

- `scripts/bt_hp_q102_highvol_frozen_forward_audit.py`：3つの元JSONの研究出所・Hash・事前凍結Gate・30bps前後コホート18対15対3・Shadow拒否ID・構造150ルールの不採用・7戦略モデルのQ102 HIGH_VOL出口6/7件を一括照合。
- `tests/test_bt_hp_q102_highvol_frozen_forward_audit.py`：10件。Gateの事後変更、18/19母集団誤認、Source Hash改変、Shadow ID重複、Forward日時逸脱、事後1ルール採用などを拒否。Python BT **272件PASS**。
- Private証跡 `C:\tmp\bt481-q102-highvol-frozen-one-shot-audit-20261115.json`、SHA256 **`B4139D3DB9E9E5F80734D47ADBEBDEA2FE9658308AEC52CDB9A62117214A6921`**。

残：19対18候補の同一Source差分と、2026-10-01以降の独立価格/出来高/OI（必要な場合）ソースからのハンズオフForward評価。Q102実取引・STOP・Kill Switch・HP認証への変更0。DD20%以下と全Runner Production完全一致も未達。