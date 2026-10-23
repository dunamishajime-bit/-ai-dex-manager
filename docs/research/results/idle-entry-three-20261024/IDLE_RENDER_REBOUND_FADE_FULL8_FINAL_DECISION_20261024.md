# RENDER SHORT 反発・再失速入口：取引回数維持×8ロジック因果BT（2026-10-24）

**STATUS: RESEARCH_ONLY / NOT ADOPTED / NO LIVE OR PRODUCTION CHANGE**

## 前提
- 期間 2025-08-10〜2026-08-10。10bps通常、30bpsストレス、毎回全8ロジック動的資金再選択3パス、モデル会計PASSとSHA照合。AVAX/PENGU初期逆行改善研究条件・DOT 直近1h>=−1%・JUP 12h>=−5%＋3h>=−1.5%を維持。
- 毎候補についてエントリー時までに確定済の5分足だけから直前3hの値幅、反発高値、直近15分リターンを作成。未来のMFE/MAE・決済価格は入口判定に一切使用しない。
- 既存候補の並べ直し・再選択のみ。新しい未発火5分足注文を作るモデルではない。保護STOPと資金のHard Cap/Shared Riskは変更していない。
- 基準RENDER30bps勝率12/24=50%、RENDER10bps勝率16/24=66.7%。

## 旧採択24件における入口15方式のスクリーニング（正式BTではない）
| RENDER入口方式 | 10bps採択後残数 | 10bps残存勝率 | 30bps採択後残数 | 30bps残存勝率 | 全H1候補164件中の残数 |
|---|---:|---:|---:|---:|---:|
| BASE | 24 | 66.67% | 24 | 50.0% | 164 |
| BOUNCE_FADE_TIGHT | 5 | 100.0% | 5 | 40.0% | 41 |
| BOUNCE_FADE_LIGHT | 8 | 87.5% | 8 | 50.0% | 65 |
| VETO_KNIFE_WITHOUT_REBOUND | 20 | 70.0% | 20 | 50.0% | 146 |
| VETO_WEAK_REBOUND_LATE_DUMP | 23 | 69.57% | 23 | 52.17% | 160 |
| VETO_LAST1H_SHARP_DUMP | 23 | 69.57% | 23 | 52.17% | 161 |

同じ期間への多重閾値スクリーニングであり、参考の勝率は未使用OOSではない。新規候補には既存ポジション・クールダウン・他戦略との共有資金制約があるため、H1候補数をLIVEの発注可能件数とは呼ばない。

## 8ロジック共有財布の統合再選択BT
| ケース | 10bps最終資産 | 対基準差 | RENDER勝率10bps | 全体取引10bps | 30bps最終資産 | 対基準差 | RENDER勝率30bps | 全体取引30bps | DD10/30bps |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 前回JUP−1.5%の件数重視基準 | 284,315,191 | +0 | 16/24=66.67% | 1285 | 173,535,687 | +0 | 12/24=50.00% | 1284 | -14.5150% / -15.0147% |
| 反発が弱く直近15分で再急落する場合だけ見送り | 284,660,883 | +345,692 | 16/24=66.67% | 1285 | 173,737,453 | +201,766 | 12/24=50.00% | 1284 | -14.5150% / -15.0147% |
| 直近1時間急落かつ反発1%未満なら見送り | 279,940,644 | −4,374,547 | 16/23=69.56% | 1284 | 169,884,387 | −3,651,300 | 12/23=52.17% | 1283 | -14.5150% / -15.0147% |

## 年間勝率が低い根因（事後分解、入口には使用不可）
- RENDERの30bps基準採択24件のうち、2026-01〜03は3/12勝=25%、2026-04〜08は9/12勝=75%。日時固定の市場ゲート導入は過学習のため禁止。
- 5分足の反発・失速を厳格な新規エントリー条件にすると採択件数が24件から5〜8件へ激減し、件数維持要件を満たせない。
- 緩い危険局面拒否では参考上約23/24件を維持できたが、ポートフォリオ全体での経済改善は表の全8結果による。

## 採否と次の研究
- この段階は過去1年に条件を繰り返し調整したin-sample研究であり未使用OOS未認証。過去サンプルの数件の差は再現性不明。
- 改善候補をForward Shadowする場合、同じ予算の既存シグナル順序と並走比較し、勝率/平均損益/全体取引数/最大DD/約定スリッページを記録する。
- 今回の入口案が不採用なら前回件数重視のJUP−1.5%+DOT 1h−1%+RENDER BTC3h−1.5%を保持する。
- 実venue保護注文ACK/partial fill/restart/cancel race、latest Production SHA一致、Hard Stop ownership、OOS未認証。VPS/Production/LIVE/HP一切変更なし。

## 研究ファイル
- scripts/dd-reduction/research-idle-render-rebound-fade-20261024.py
- scripts/dd-reduction/screen-idle-render-rebound-fade-selected-native-20261024.py
- scripts/dd-reduction/test-idle-render-rebound-fade-20261024.py
- scripts/dd-reduction/run-idle-three-entry-native-full8-20261024.py
- scripts/dd-reduction/audit-idle-entry-three-native-full8-20261024.py
- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_REBOUND_FADE_PREALLOCATION_SCREEN_20261024.json
- docs/research/results/idle-entry-three-20261024/IDLE_RENDER_DOT_JUP_LATEST_FULL8_ENTRY_AUDIT_20261024.json
