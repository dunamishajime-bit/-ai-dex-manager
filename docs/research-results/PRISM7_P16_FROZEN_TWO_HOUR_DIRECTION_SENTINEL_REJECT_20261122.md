# PRISM VII P16 — source SHORT53の確定2H方向再判定：情報増やしても誤SHORTを十分識別できず（2026-11-22）

**判定 REJECT / 本番採用不可。元SOURCE自然SHORT53件を削減せず、勝率・損益・STOP一切変更なし。** 結果閲覧前に凍結した6特徴量・「3票以上の方向再確認」ルールをすべて元SOURCE fixed pin `1657e173d250ad58f53e62f7bb0a3428fb405496` の原本53候補に適用。P14のM5時間順STOP研究とは異なり、P16は**保有後2時間に確定したH1市場方向情報の予備分類のみ**、本当の決済を行わない。

## 1. 元の53件を保護した分類結果

Source originalは **29勝24敗**。元entryTsから2つのH1が確定した時点で、PENGU 2H価格上昇 / BTC上昇 / BTCに対するPENGU相対上昇 / 出来高伸長 / ENTRY以前の3H高値上抜け / SHORT順行不足の6特徴量を凍結閾値で判定。3票以上で`DIRECTION_RECHECK_REQUIRED`を立てる。

元53件のうち1件は2H正出来高PENGU印字がないため「UNKNOWN」、価格変化を成功・失敗へ付け替えない。**診断可能52件**での混同行列：

| SOURCE実際のモデル結果 | 再検討フラグあり | フラグなし |
| --- | ---: | ---: |
| **元の負け** | **7**（負け発見） | **17**（見逃し） |
| **元の勝ち** | **6**（誤警戒） | **22**（正しく保持） |

元SOURCEの負け24件のうち**7件しか発見できず**、元勝ち28件のうち**6件に誤フラグ**。後からSHORTを止めれば元勝ちを相当削り、なお負け17件を残す。だから**判定を自動STOP/反転注文に採用しない**。

追加でscore0〜6を連続的に元SOURCE負け/勝ちと照合し、**AUC=0.491071**（乱数判定とほぼ同等、逆方向の弱い関係）、期間別に元の勝敗ラベルを入れ替える固定seed 5000回の二側null検定 **p≈0.906419**。SOURCEの既知53トレードについて、今回の6条件が負けを区別できる有意な証拠はない。

期間別（original勝敗はsource modelで、P16は経済的な実注文/新勝率ではない）：
- PRE 2025 Aug〜Sep 6件：元4敗中2フラグ、元2勝誤警戒0、score loss AUC 0.875（n6）。
- BASE 2025 Oct〜2026 Sep 39件診断可：元16敗中**3件のみ発見**、元23勝中**6件誤警戒**、AUC **0.434783**。**主要BASE期間で実際は逆効果になる危険が高い**。
- POST 2026 Oct〜Nov 7件：元4敗中2件、元3勝誤警戒0、AUC 0.5。
- source53件全体の経済勝率は元の29/53=54.717%で不変。上のscore AUCやフラグをPENGU80%達成と誤称しない。

## 2. 反例と研究の更新

P9同一H1過去からの未来2世界は13entryの同じ源情報で8件が急反発すると勝ち→負けに変わる反例だった。P10は保有後2H以上の方向pressureで早期EXITを入れ、SOURCE real53勝ち29→18・mean+1.001%→−0.782%・PF1.377→0.593と破壊した。今回P16で他の6featureを加えてもAUCほぼ0.5、元BASE期間では3敗発見・6勝誤警戒となった。**単に指標を足し合わせる決定ルールでは、期待方向や先の急反発を識別できない。**

P16条件のスコアを見てルール閾値を調整し、AUCや勝率を後付けで改善することは過学習になるので行わない。必要なのは**市場の確率構造を別資料で学習し、実時間以前に目的変数が観測確定したサンプルだけ更新するOnline/Walk-forward予測**、同時にP14の執行/STOP再価格と資金リスク、原勝ちを保持する検証を分離すること。Source original53の各取引を学習した上で同じ53をOOSと呼ばない。

## 3. コードと再現性

- Precommitted `PRISM7_P16_PRECOMMITTED_POSTENTRY_2H_DIRECTION_SENTINEL_20261122.md`。
- 53 source fixed SHAをnative feature ENTRYで照合して2H市場情報を個票出力 `scripts/research/prism7_p16_source53_asof_2h_direction_diagnostics.mjs`
- cohort内ラベルシャッフル5,000回の固定seed (20261122)とAUC `scripts/research/prism7_p16_frozen_direction_significance_20261122.py`
- 独立 regression `scripts/research/test_prism7_p16_source53_asof2h_direction_20261122.py` **4/4 PASS**。source原53と期間別 entry/exit/price/reason一致、2H未来情報がentryより前に紛れ込まないこと、元の注文を変更しないことを確認。
- summary SHA256 `fac4ee4a6722faa7f15bf64a272ee8d839a2866e27a5ebf933a7452e406bfa7f`
- 53個票 ledger SHA256 `5cbb83990e5f672b52565b4fb51fb3f0f450e6272a27cc3cf3349f66b63ce788`
- statistics JSON SHA256 `160ba42ad373d6047da7f16cffd61bdfe3464325df233839b2035f21ce4c71ad`
- Native53 summary + 53個票は2ファイルを独立再実行し両SHA一致。5000回null検定結果はseed固定で再実行可能。

## 4. 結論

P16のフラグを採用せず、元のPENGU取引の勝ち29をそのまま保存。より多くの特徴量・単純なvote追加では**PENGU80%・総合DD≤20%達成の根拠にならない**。次はP14の時間順執行研究と、目的を「将来24Hの市場方向」に固定したprior-H1のみのonline learnerを別学習系列で試し、source自然SHORTへの機会価値を walk-forward で検証する。未観測OOS・LIVE signed fill・Funding/Gross/複利は未検証。

**本番master/VPS/Runner/実注文/建玉/STOP/Kill Switch/HYPE変更なし。PR #595 Draft研究専用。**
