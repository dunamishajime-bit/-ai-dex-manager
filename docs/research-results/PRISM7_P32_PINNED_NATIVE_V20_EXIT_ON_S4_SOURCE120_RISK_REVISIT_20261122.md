# PRISM VII P32 — 元固定SHAのSHORT V20純粋EXIT状態を新S4 ENTRYへ接続した経済比較（本番変更なし）

**SOURCE pin 1657e173d250ad58f53e62f7bb0a3428fb405496、元V20自然SHORT53件/29勝は独立に完全保存**。新S4の元構造SETUP120件、正印字5分足のENTRY時刻・価格を変更せず、最新確定H1のSOURCE ATR/BTCを初期値にして、源純粋 `createPenguShortV20State` と `evaluatePenguDualLsV2PositionBar` によりphase/期限/stopを時刻順に再演。M5 resident STOPは正出来高HIGHの初回タッチを価格代理とし、非resident完了H1 EXIT意図は次の正出来高M5 OPENへ遅らせる。従来P22の共通REFERENCE_STOP72と同じSOURCE原ENTRYだけを比較する。

| 30bps/同一新S4構造120/1枠（positive M5価格モデル） | 従来参考STOP72 | SOURCE pin native V20 EXITを適応 |
|---|---:|---:|
| 初期H1構造SETUP | 120 | 120 |
| 完了モデル取引 | 21 | 21 |
| モデル勝ち | 15 | 15 |
| 条件付勝率 | 71.429% | 71.429% |
| 平均net/決済 | 4.934% | 3.922% |
| PF | 3.906 | 3.289 |
| 未実現含むSOURCE M5 CLOSE最大DD (1.0x) | 35.942% | **35.942%** |
| 前完成M5 peakに対するHIGH逆行stressDD | 37.647% | 37.647% |
| 最終参考NAV（右打切りopen含む） | 25557.317円 | 20992.517円 |

## 新native EXITに対する固定gross検査（30bps/追加滑りなし）

| 過去に固定した gross | 新native EXITのM5 mark DD | 新native EXITの時間順HIGH stress DD | 勝ち |
|---|---:|---:|---:|
| 0.750x | 29.533% | 31.064% | 15件 |
| 1.000x | 35.942% | 37.647% | 15件 |
| 1.250x | 41.348% | 43.130% | 15件 |

- 元SOURCE自然SHORTの入口は**新S4と異なる**。したがってこれは「本番SOURCE V20にS4シグナルが実際に生成される」とは証明しない。新S4の時刻がH1中途の場合、最新完全H1で初期化する研究adapterであり、SOURCEランナーのフル約定・建玉・native V20本来の入口ではない。
- 研究で使用した SOURCE H1原gzip SHA/M5原gzip SHA・native TS import SHA・P22新S4 120case元SHA・元P8 SOURCE53原本のentry/EXIT台帳は JSON summaryへ固定。native純粋出口関数自体は変更していない。
- SOURCE 5M positive印字のHIGH/OPENとSTOP価格は自己署名約定、実際の買い板/ASK depth、stop priority、spread、funding、API競合を保証しない。右打切り建玉は約定を架空生成しない。
- この既知2025Aug–2026NovのS4構造は過去成績を観測して設計したので真の未見OOSでない。研究のSOURCE M5 mark DDが20%を超える場合は**そのまま不採用**とし、20以下に見えたとしても他Runner Shared Gross/day loss,現物/他通貨含むリアル口座DD、signed fillsの実証なしでは本番認証できない。

## 再現コードと台帳

- 事前登録 `docs/research-results/PRISM7_P32_PRECOMMITTED_S4_SIGNALS_V20_SOURCE_NATIVE_POSITION_EXIT_COMPARE_20261122.md`
- 源純粋 EXITの isolated Node TS adapter `scripts/research/prism7_p32_native_s4_non_source_entry_m5_exit_core.mjs`
- 120候補/native S4個別POSITIONをSource H1/M5でモデル化 `scripts/research/prism7_p32_s4_source_native_short_v20_m5_replay_harness.mjs`
- 1倍M5 mark DD・0.75/1/1.25倍・前M5 close先行HIGHリスク計算 `scripts/research/prism7_p32_native_s4_source_m5_mark_risk_compare_20261122.py`
- 回帰 `scripts/research/test_prism7_p32_s4_native_v20_exit_source_contract_20261122.py`（5件、元SOURCE53、S4 120、newENTRY before exit、SOURCE nonresident source H1未完了執行禁止、手数料を独立検査）。
- `docs/research-results/prism-phase2-20261122/PRISM7_P32_S4_NATIVE_V20_EXIT_REPLAY_SUMMARY_20261122.json`
- `docs/research-results/prism-phase2-20261122/PRISM7_P32_S4_NATIVE_V20_ALL120_EVENTS_20261122.json`
- `docs/research-results/prism-phase2-20261122/PRISM7_P32_S4_NATIVE_V20_ALL120_SINGLE_SLOT_20261122.json`
- `docs/research-results/prism-phase2-20261122/PRISM7_P32_S4_NATIVE_V20_EXIT_31_POSITION_DETAIL_20261122.json`
- `docs/research-results/prism-phase2-20261122/PRISM7_P32_NATIVE_S4_SOURCE_M5_MARK_RISK_COMPARE_20261122.json`
- `docs/research-results/prism-phase2-20261122/PRISM7_P32_NATIVE_S4_POSITION_RISK_LEDGER_20261122.json`

**SOURCE自然53/新S4 source120/参考STOPとnative SOURCE純EXITの区別を徹底**。PENGU原戦略勝率80%以上、実口座全RunnerポートフォリオDD20%以内は未立証。Production master/VPS/Runner/建玉/注文/STOP/HYPE/KillSwitch変更なし。PR #595 Draft研究のみ。
