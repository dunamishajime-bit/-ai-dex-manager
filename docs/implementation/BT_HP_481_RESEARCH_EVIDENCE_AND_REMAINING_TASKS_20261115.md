# PR #481 — BT検証の恒久タスク・証拠台帳（2026-11-15）

## 運用方式（ユーザー指示）

完了したタスクは**そのタスクのソース／ユニットテスト／検証手順／結果証拠を揃えて単独コミット→GitHubへPush→記録**。報告を挟まず次のタスクを開始する。調査途中の未検証統計を「改善済み」へ昇格させない。結果はOwner PCのprivate JSON/CSVに保存し、GitHubへは元データをPushしない。全BTの正式本番経済パリティ・OOS過学習排除が成立する前に、LIVE切替に結びつけない。

## 完了済みの主な研究タスク（正しい対象と限界）

| Commits | テーマ | 結果・上限 |
| --- | --- | --- |
| `844aabf6f` | HYPE native M5出口契約 | native STABLE TREND候補78のATR/Stop/TP/モデル出口78/78一致、**実約定Fill/Source KillSwitch証明は未成立** |
| `2ec22c581` | HYPE standalone DD | 56/78モデル採用、15勝41敗。10bps DD−19.32%、30bps DD−23.26%、30bpsは基準DD20%超過 |
| `ace560545` | 8ロジックの名称スコープ | native売買系統7と共通制御2。V12を独立第8戦略として数える根拠なし |
| `b06791c14` | HYPE/native/H48/no-HYPE統合BT | HYPE nativeのモデルDD−40.24%(10) /−27.37%(30)。全6ケース各105,121 source Gross/Equity観測を再計算 |
| `c1af03936` | Q102 FET PB168 | Pretarget train PF0.413／validation2.132／prehold4勝。target統合6件5勝1敗でも対象年1負けで削除不可 |
| `206f469d7` | Q102 HIGH_VOL | 19元候補(ONDO10 SUI7 ARB2)、10bps入場7(未決済1)、30bps入場8(未決済1)、独立OOS不足 |
| `2baeb0021` | HYPE Layer2/3 as-of Shadow | 78候補、直近20完了取引の参考勝率を計算可能な51候補。採用権限なし |
| `0f7c93ce5` | HYPE Layer3同時刻競合 | 78時刻のうち20時刻で別Runner候補計28、EV推定不足で優先順位null |
| `8b016fd05` | HYPE Layer2 prequential | モデル採用36件でrecent20 Brier0.2162はall-history0.20594に劣る、採用不可 |
| `2d1db5f72` | PENGU SHORT_V20 | Pretarget候補121でrobust0、Forward6全BLOCKは勝ち2件も失う。方向SHORT固定、Gate採用なし |
| `0a67c439c` | V4 Y06出口研究 | Horizon4、ProfitLock10、OnlineSkip65すべてPretarget/Forward合格0 |
| `e015102b3` | V4 Y06方向とEpisode | 352候補の誤方向proxy Train18.48%→Validation47.14%→Test67.61%。非IID Episode31、境界跨ぎ2 |
| `3a7302b2f` | Q102 AVAX/UNI再設計Forward | AVAX/UNI構造候補Pretarget3/9でForwardは混在、Online AVAX3 target mean全負/UNI0、採用なし |

これらの成績は**現行本番のNative Quantities/venue Filled Ordersで検証された結果ではなく、historical researchモデル**。STABLE4研究wrapperには元sourceのProduction以外のGateが残る。以前のHYPE H48研究入口5件と現行HYPE TREND入口78候補は別ロジックであり、長期複利最終金額を同一政策として比較しない。

## 残存タスクの優先順位（未完＝未認証）

1. **全Runner最新immutable pin / Source→Decision→Executor provenance**：V4を含む各pinとResearch使用source SHAの表・差分・バージョン固定を作る。V4はCodex切替中につき作業競合回避、本番設定・認証・systemd操作はしない。
2. **Shared Risk／Gross／STOP／KillSwitchのhistorical as-of証拠**：入口時点の既存建玉、未約定注文、プロテクトSTOP所有、risk7.5%、Crypto3.0x/Stock1.5x/Total3.5x、API競合・margin、Fee/Fundingの証拠を元ソース/ledgerと照合する。HYPE過去研究5件に関する元のas-of共有Gateは0/5証明済み、UNKNOWNならFail Closed。Venueレベルは署名済みソース以外で断定しない。
3. **Q102 HIGH_VOLの対象年前→Forward別期間 native再生**：ONDO/SUI/ARBの19候補は2026年7〜9月集中。独立期間が不足したらゲート採用せず、別市場データ＋時間分離・Episode相関で方向/出口を検査。
4. **V4 REC_Y06のEpisode単位の誤SHORT回避研究**：352候補を31 Exposure Episodeへ再分解、Validation悪化を再検証。Code/Live切替はCodexが実施。対象年のtest損失を選別・しきい値調整に使わない。
5. **PENGU SHORT_V20の固定SHORT複合判定**：Prehold/Forwardでロバストな候補がまだ0、Forward6件の全遮断は改善ではない。V2/Recovery V8にShort V20変更を誤適用しない。
6. **Q102 AVAX MR24／UNI MR72の方向・出口**：研究候補AVAX3/UNI9からForward bestを遡及採用しない。現行pin/exit一致・独立OOS・5分M5経済・同一レイヤーで保留。
7. **HYPE/IDLE Layer2 OnlineとLayer3 Opportunity**：HYPE過去参考最近勝率のCalibrationは基準に劣る。V4/Q102/PENGU/FET同時候補のas-of EV・信用度・採用機会費用、将来コスト条件をソースから生成し事前freeze。不明ならEV順位を空欄のままにする。
8. **10bps／30bps統合複利BT完全再計算**：全7売買系統と管理Runner責務の明示、全Fill、model-open/terminal position, DD, False direction, Gross, 10/30bps、JPY10,000開始／2025-10-01〜2026-10-01 UTC。モデルDD20%以下は達成前提ではなく合否条件。勝率改善・利益維持は確認してからGate採用。
9. **UI専用BT研究ページ**：ローソク足を完了H1/M5生成・as-of足ごとのprice/OHLC上下実動作と連動させ、背景/Balance/専用メニュー／HP戻る・動的Grossマーカーと仮想決済を検証。研究モデルに本番認証済み表示を付けない。HP正式反映は別途Owner承認とCIパイプライン。
10. **最終Approval/Production**：GitHub Actions/HPの正式承認とCodexによるV4切替、Ownerの許可されたscopeでのみLIVEへ。研究PR #481はDraftを維持し、本番注文・Cancel・STOP/保有建玉の操作は別経路にする。

## この台帳作成時点でのオフライン回帰検証

- `python -m unittest discover -s tests -p 'test_bt_hp_*.py' -q`: **194 tests PASS**。
- `npx tsx scripts/bt-hp-native-hype-trend-h1-selftest.ts`: **12 tests PASS**。
- `npx tsx scripts/bt-hp-native-hype-exit-contract-selftest.ts`: **15 tests PASS**。
- `npx tsx scripts/bt-hp-replay-selftest.ts`: **10 tests PASS**。
- `npm run typecheck` と `npm run build`（Next.js 16.2.6 webpack）：**PASS**、researchページ `/bt-verification` のビルドルートを確認。
- このPASSは**開発ブランチのオフライン検証**。GitHub CI・HP正式承認・LIVE切替・Portfolio経済パリティ証明とは区別する。

## Fail-closed継続規則

- Target-year 2025-10〜2026-10の負けから停止Gate・閾値・post-entry Exitを作り、同じ期間で成果を誇示しない。研究と認証・Forwardの母集団は明確に切る。
- Episode相関・保有中MTMと約定済み損益・実venue FillとモデルFill・資金予約Grossと時価Grossを区別する。
- 独立市場と経済パリティを満たす改善が出るまでは、**利益・勝率・DD改善済み／本番へ採用可能**とは書かない。
- この台帳を次回再開地点とし、タスクごとに文書・ユニットテスト・コミットを積み上げて続行する。

## 追記：2026-11-15 Codex V4切替後の新たな研究ブロッカー

- ユーザー申告のV4切替完了を踏まえ、VPS登録manifestをread-onlyで確認：`V12_V4=e788abc82e80f9fc7ab0e1ba83fdb8be267eb513`。V4対応Broker稼働は観測したが、新V4本体のactive/runningとvenue状態は未認証。旧unit failedが残るため、旧unitの失敗を新V4に直接帰属しない。詳細：`V4_CODEX_POST_ACTIVATION_READONLY_HANDOFF_20261115.md`。
- `01c8f7a13` 現行9pin manifestと10/30bps研究BT7系統を比較。**V4とHYPEにsource mismatch**、Q102/PENGU/V52/IDLE/FETはpin SHA一致のみ。新V4 sourceの本番経済完全再計算まで`BLOCKED_REPLAY_REQUIRED`。本番LIVE/STOP証明は別。
- `fe0269635` 研究BT結果画面に切替後V4ピン差分を明示。既存HYPE H48との差分警告は維持。
- `0742bc89b` HYPE native TRENDとHYPEなし対照の10/30bps、合計4つのsource-hashed private ReplayをOwner PC内へ生成。Aster BTC確定H1 8,928本、研究元Gross・Funding/Partialイベント、未決済モデル建玉を保持。研究ケース3種を`source-pin-observation.ts`で明示警告、SHA256検証4/4 PASS。Private: `C:\tmp\bt481-hp-replay-library-native-hype-nohype-20261115`。**HP正式配信・publicへのコピーはしていない**。
- `ec7a315ef` V4 Codexに返すread-only確認とimmutable release source取得・検証の要件を文書化。
- 追加後のオフライン検証：Python204件PASS、追加native/noHYPE private library 4件SHA256 PASS、V4 pin複数ケースUI assertion PASS、TypeScript typecheck／Next.js webpack build PASS。GitHub CIは最新SHAについて別途確認。
- **未完了の最優先**：新V4 release `e788...` のexact runtime sourceと正式LIVE本体・STOPの読取専用証拠。GitHub commit APIにはこのSHAのcommit objectなし。旧STABLE4のV4をこの新V4へそのまま同一視してBT完成/正式LIVE経済一致としない。要求DD≤20%は元研究シナリオの現状で未達成であり、改善済みを主張しない。

## 追記：2026-11-15 Shared Risk・V52資本・最大DD・IDLE Layer2・同時刻Gross Gateの実証

順番にテスト→証拠作成→単独コミット→GitHub Pushを終えてから次タスクへ移動。

1. `cfcd3ad81`：Shared Risk 7.5% と日次Gate・Gross時価・V52専用日次リスクを10/30bps全105,121×2の5分時点で照合。10bps 1,025・30bps1,026モデルAdmissionでGate True時新規Entry0。Gross MTMの上限超過は存在し、入場超過と分離。V52の損失率が極端になり分母スケール未解決と判定。根拠 `BT_HP_SHARED_RISK_V52_GROSS_ASOF_AUDIT_20261115.md`。
2. `0ac782968`：上記V52分母の元研究ソース式を再現。V52資本は `max(約800円, equity - 他のV96対象銘柄のGross Notional - 10%reserve)`。10bps81、30bps83の最低資本分母すべてが元5分時価Positionから再現可能。ただし本番運用設計の妥当性・V52ライブ約定は未認証。根拠 `BT_HP_V52_MINIMUM_CAPITAL_DENOMINATOR_PROVENANCE_20261115.md`。
3. `44751c5f1`：元研究全5分MTMで最大DDピーク 2026-08-05 07:00 UTC → 2026-09-22 11:00 UTC。10bps −40.2388%/−383.66万円、30bps −27.37075%/−112.68万円。Cash＋元建玉未実現PnLとEquity完全一致。決済ベースはQ102が最大損失だが原因の識別は別検証必要。DDの悪い期間から閾値fitを禁ずる。根拠 `BT_HP_INTEGRATED_MTM_MAX_DD_FALSE_DIRECTION_WINDOW_20261115.md`。
4. `5889157e7`：Owner非公開のHYPE TRENDあり／なし比較モデル(10/30bps)をBT研究ライブラリのUIへ追加。4-case INDEXが揃いSHA/出所/Grossが妥当な場合だけ比較表示。両経路でDD20%未達。過去研究のHYPE非採用が本番停止の根拠になると主張しない。型検査＋Next build＋全Python PASS。根拠 `BT_HP_NATIVE_HYPE_SIDE_BY_SIDE_MODEL_COMPARISON_20261115.md`。
5. `6f05aa82e`：IDLE新1x/1-slot（RENDER固定SHORT、DOT固定LONG、JUP/TIA Online）の研究元Frozen pretarget→Target270・Forward33の別市場照合。Target30bps勝率53.70%、単独決済DD−33.26%、Forward30bps勝率66.67%・DD−14.38%。母数33で高勝率保証不可。別ALL5P Online確認は218件中反対Gateが0で成績改善なし。根拠 `BT_HP_IDLE_1X_VNEXT_LAYER2_FORWARD_20261115.md`。
6. `6d175ad9f`：Gross3.0/1.5/3.5xの研究新規Admission Gateを同じtickの**複数Entryの合算**で確認。10bps計1,025件（176回複数同時）、30bps1,026件（174回複数同時）。新規入場によるモデルGross上限超過0。既存Stock MTM 1.5x超過は同時点10bps15・30bps16件だが、その際に新Stock Grossを増やしたわけではない。モデル登録時点での約定実態は未認証。根拠 `BT_HP_GROSS_ENTRY_ASOF_TICK_MULTIPLE_ADMISSIONS_20261115.md`。

BT Python回帰テスト **252件PASS**（今回まで）。研究Owner private JSON元資料は非公開維持、GitHubへは監査ソース・ユニットテスト・文書だけ。既存のsourceピン不一致（新V4/HYPE）と残存のDD20%超過、Signed venue STOP/Fillの不一致、独立相場による全Runner統合OOSの欠落は依然として最重要ブロッカー。本番LIVE Runner・注文・STOP・Kill Switch・資金Grossの操作は0件。

次の優先研究はIDLE/ HYPE Layer3同時点EVの証拠確認、Q102 HIGH_VOL独立Forward集計、Risk/fee/gross同時競合・V4最新版元Sourceの研究統合リプレイ。結果を見てから対象年の損失Gateを逆算最適化しない。

## 追記：2026-11-15 13:55 JST以降 — BTCレジームとQ102 HIGH_VOL年度末右打切り

1. **`7a9f449f4`**：Aster BTC H1連続8,928本に限定、ENTRYの直前に確定した足のみを使用した24h/72h return・24h volatilityを固定の説明用カテゴリに集計。DD谷2026-09-22の10bps model exit59件のうち、BTC高変動タグ11件中10件敗北。ただし30bpsは同じ11件中6敗で、対象年に合わせたHigh-vol Gate導入は不可。10bps/30bpsの全モデルFee/Funding、source SHAとDD区間を元台帳に照合。 `BT_HP_BTC_CLOSED_H1_MAXDD_REGIME_FALSE_DIRECTION_20261115.md`。
2. **`86df81bb9`**：Q102 HIGH_VOLの事前固定90日min5/PF0.60 online shadow GateはPretarget202件の基準勝率49.01%→Gate採用138件44.20%、Target一回だけ18件33.33%→通過15件20.00%に悪化。ターゲット遮断3件は結果的に全勝、対象年へリフィット禁止。150候補のrobust gate0。研究Target baseline18とNative19は母数が異なるまま別Gate。 `BT_HP_Q102_HIGHVOL_FROZEN_SHADOW_TARGET_GATE_20261115.md`。
3. **`4ddcfd195`**：Q102 HIGH_VOL Native 19候補（ONDO10/SUI7/ARB2）をsource pinの3台帳へIDで照合し、対象年終端までに**18件決済、SUI LONG1件右打切り**と確定。未決済 Native ID `HIGH_VOL:SUIUSDT:1790650800000`、2026-09-29 04:00 UTC entry、予定Exit2026-10-02 03:00 UTC。基本native出口は`RIGHT_CENSORED_PERIOD_END`でFillなし。統合10/30bps双方で`Q102P_00224`の期末未決済を再確認。研究Shadow baseline18との**件数差は正しく区別できた**がOnline通過15件の行単位ID完全一致までは未証明。`BT_HP_Q102_HIGHVOL_19_TO_18_CLOSED_END_BOUNDARY_20261115.md`。

BT Python回帰テスト合計 **282件PASS**。3タスク各々テスト→Git commit→Push済み。元Private証拠データはPC維持、public/Productionへ無断公開していない。GitHub PR #481 はDraft維持。最新V4 source完全一致、8Runner役割/全銘柄統合OOS、最大DD20%以下・勝率向上は継続ブロッカー。実注文・決済・STOP・Kill Switch・GitHub master merge・HP本番デプロイ0件。
