# Task 9 / V12 LONG 累積検証 (2026-10-21)

## 結論
**REJECT_NEXT_V12_LONG_2P0_CUMULATIVE / KEEP_SHORT_PARENT_RESEARCH_ONLY**

前段V12 SHORT 2.5%逆行STOP + 12h同銘柄同方向Cooldownは、30bps最終資産維持率73.36%で不採用判定を維持する。ただし、その研究設定を次段へ渡す比較用の親として使用した。今回V12 LONG 2.0%逆行STOP（エントリーから12時間経過後、事前MFE +1%未満）を追加し、両方で**BT採用建玉が実STOP決済になった場合のみ**12h Cooldownを発生させた。

## 全8ロジック共有資金配分BT（初期1万円・積立なし・複利、2025-08-10〜2026-08-10）

| ケース | 10bps最終資産 (円) | DD | PF | 30bps最終資産 (円) | DD | PF |
|---|---:|---:|---:|---:|---:|---:|
| Baseline | 222,818,966.88 | -15.62064% | 3.4588 | 124,289,206.82 | -16.78777% | 3.0786 |
| SHORT親 2.5% STOP+Cooldown | 204,448,513.25 | -14.79603% | 3.1966 | 91,181,051.23 | -15.41170% | 2.7500 |
| LONG単独 2.0% STOP+Cooldown | 216,573,603.74 | -15.61636% | 3.4570 | 92,906,606.36 | -16.80460% | 2.7908 |
| SHORT親＋LONG累積 | 197,659,615.40 | -14.79603% | 3.1974 | 79,969,990.98 | -15.40107% | 2.6337 |

- LONG単独の成立STOPは10bpsで12件、30bpsで11件。同Cooldown見送りはいずれも0件。
- 累積成立STOPは10bpsでSHORT52件・LONG11件、30bpsでSHORT51件・LONG11件。Cooldown見送りは各20件。
- 累積のSHORT親比：10bps資産96.68%、DD改善0.00pt。30bps資産87.70%、DD改善+0.01063pt。
- 累積のBaseline比：10bps資産88.71%、DD改善+0.82460pt。30bps資産64.34%、DD改善+1.38670pt。
- LONG単独30bpsはBaseline比でDDが0.01683pt悪化。**追加LONGは採用条件を満たさない。**

## 原本・技術条件

- 8ロジック共通コアで採用・除外・Gross・数量・Funding・決済・MTMを再実行。各ケースの3,185候補、8ロジック、8,761時間H1 MTM、会計PASSを確認。
- 取引採否後の実際の modeled STOP決済のみを起点に同じsymbol/sideのCooldownを適用。未採用候補による誤Cooldownは不許可。
- 以前のSHORTのみの実行経路・元の20/20 SHA監査は変更せず、LONGはopt-inの研究用拡張。
- 既存の独立TypeScript配分器との経済完全一致・実取引所の署名付きSTOP / fill / partial fill / pending照合・未使用期間のOOS検証は未達。経済BTはモデル価格でありLIVE認証ではない。
- PENGUやLIVE/VPS/HP/本番注文の変更なし。

## コード / 證拠

- 新しい研究BTランナー: scripts/dd-reduction/run-task9-next-v12-long-cumulative-20261021.py
- 共通コアの承認済STOP後だけCooldownを開始する研究フック: scripts/dd-reduction/task9_legacy_evidence_capture.py
- 回帰テスト: scripts/dd-reduction/test_task9_native_full8.py
- コンパクト台帳 + 再現性証拠: task9-next-v12-long-cumulative-20261021.json
- CI Fail Closed監査: scripts/dd-reduction/verify-task9-next-v12-long-artifacts.py
- 生市場データおよび全取引ledgersはWindows PCの研究フォルダに保持し、GitHubにはアップロードしない。

次段への規則：SHORTは実験上の親として比較継続可能だが、採用済みとはしない。両コストDD改善・30bps維持率75%以上・独立未使用期間での再検証が確認できた候補のみ次段の正式累積候補に昇格させる。
