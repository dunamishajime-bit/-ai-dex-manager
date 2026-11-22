# PRISM VII P16 — natural SHORT53の保有後2H / 相場方向の因果再判定（結果計算前固定）

**研究専用、まだ取引ルールではない。** 以前P7 as-of ENTRY8特徴量では元勝ち29・「順行<1%」負け11を識別できなかった。P9同一過去13ペアでは「未来squeezeでsource勝ち8件が負けへ反転」し、ENTRYだけで未来を選べない。P10一律買い圧力EXITはsource real53で29勝→18勝と失敗、P14ではM5時間順price proxy52件を得たが新戦略は未確立。そこで**H1確定後の2H新情報が元勝ち29/元負け24を区別できるか**を確認する。SOURCE固定SHAは `1657e173d250ad58f53e62f7bb0a3428fb405496`。

対象は既見のreal source native53件を削らず全数保持。H1 source PENGU/BTC同期・元SOURCE ATR24とENTRY直前H1特徴量、SOURCE original exit parity53/53を必須。ENTRY時刻Eから[E,E+1H),[E+1H,E+2H)の2つの**完了済みH1**をE+2Hまでに観測。判定に将来のsource exit価格・理由・regime labelを使わない。2Hでのas-of観測が無い時はUNKNOWN（勝ちへ数えない）。

事前に**変更しない6個の根拠**を固定する:
- A: PENGU2H終値 vs source ENTRY価格の上昇 >= `entryAtr24Ratio` (ATR24)
- B: BTC2H終値 vs BTC entryH1 OPEN の上昇 >=+0.25%
- C: PENGU2HリターンからBTC2Hリターンを引いた値 >=+1.0pp (PENGU相対強さ)
- D: PENGUの2H出来高合計 / prior2H合計 >=1.5 (ゼロ分母はUNKNOWN)
- E: PENGU2H終値がENTRY時点で既知の直前3Hの最高値を上回る
- F: ENTRY後2HのPENGU Lowsの最大好方向下落幅がentry ATR24の0.5倍以下（SHORTの順行欠如）

A〜Fのうち **3票以上**で `DIRECTION_RECHECK_REQUIRED`、それ以下は `CONTINUE_NATIVE_SHORT_REVIEW`。このフラグは評価専用で**SHORT決済/ロング反転/注文/STOPを一切変更しない**。人工レジームの未来ラベル、元SOURCE win/lose label、H1 exit reasonを特徴に混ぜない。データゼロvolumeなど観測欠損の時は別フラグで印字品質を残し、5分足の実行可能性はP14の別ゲート。

結果として原source勝ち/負け両群の陽性率、TP/FP/FN/TN、score AUC、period別、bootstrap/permutation（cohort内ラベルshuffle 5000回固定seed）を検算。標本数少なくPENGU80%確約不可。危険フラグを立てた元勝ちを犠牲にする割合も必ず報告し、元勝ちを削って勝率だけを上げたとは言わない。score/閾値は研究結果後に変更禁止。PR #595 Draftにコード・全53個票・SHA/testを保存。

本番master/VPS/Runner/STOP/注文/建玉/HYPE/KillSwitchや他Codex作業領域を触らない。
