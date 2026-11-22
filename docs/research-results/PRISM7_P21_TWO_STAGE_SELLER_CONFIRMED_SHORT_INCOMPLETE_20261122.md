# PRISM VII P21 — M5売り成立を待つ2段階SHORTは部分改善、元V20には未到達。Route Bは10勝/12で小標本。

元SOURCE pin `1657e173d250ad58f53e62f7bb0a3428fb405496`、P20 `PENGU_S3_STRUCTURE_V1`新候補120件を不変のまま、予めGitHubで固定したP21状態機械 `PENGU_S3_CONFIRM_V1` で比較。生来H1構造を知った時点で約定できたと見なさず、次2HのM5正出来高3本（直近35分以内）、taker買い比率<=0.42、固定signal H1安値0.2%以上の下抜け、M5確定closeから**必ず次のpositive print M5 OPEN**へ遅らせた研究価格代理でエントリー。P20と同じハードSTOP8%/前H1までのtrailing15%→戻り4%/最大72Hを使用。SOURCE本来のV20 phase-native exitやsigned executionは再現したと主張しない。

## 全体比較：SOURCE・P20・P21は同じ参考出口/手数料

| 30bps・追加滑り0・PENGU単独1枠 | SOURCE元V20 H1入口 | P20初版3構造 | P21売り成立確認 |
| --- | ---: | ---: | ---: |
| 発火/元候補 | 53 | 120 | **120** |
| price-proxy EXIT完了 | 33 | 53 | **34** |
| モデル勝ち | 17 | 25 | **19** |
| 条件付き勝率 | 51.52% | 47.17% | **55.88%** |
| 平均net | **+1.535980%** | +0.299541% | +1.002445% |
| PF | **1.560015** | 1.084057 | 1.296183 |
| 実現損益のみの参考DD | **28.075%** | 44.743% | **31.167%** |
| 10,000円順次複利参考終了値 | 14,914円 | 9,708円 | 12,496円 |

P21は120初期構造セットアップのうち **69件が2H以内に売り確認なし、2件は確認したが次の正印字OPENなし、15件は単一枠が使用中、34件がENTRY/EXITの価格代理完了**。見送り機会を後付けの「成功した勝ち」へ加算していない。120全セットアップ当たりのnet利益pct-pointは全34取引の合計34.083/120=**+0.284pct-point/元セットアップ**。S3 P20の単一枠53取引合計15.876/120=+0.132pct-point/元セットアップより改善するが、SOURCE元自然53の単一枠33取引合計50.687/53=+0.956pct-point/元信号未満。**一律の方向判定や出口設計より構造発見と成立確認を別段に分ける方式に価値はあるが、元SOURCE全体を改善できていない。**

## 路線ごとの落差が大きい

| P21固定30bps / 単一枠 | 初期構造setup | 価格代理ENTRY/EXIT | 勝ち | 平均net | PF |
| --- | ---: | ---: | ---: | ---: | ---: |
| `SELLER_PULLBACK_REJECTION` | 58 | 22 | 9 | **−1.600462%** | **0.641103** |
| `BREAKDOWN_RETEST_FAILURE` | 58 | **12** | **10** | **+5.774442%** | **5.083776** |
| `RELATIVE_WEAKNESS_DOWNSHIFT` | 4 | 0 | 0 | 未定義 | 未定義 |

Route Bの元58構造候補中41件はM5売り成立待ち条件を満たさず、2件printなし、3件枠占有などで最終**12件のみ約定代理**。83.33%（10/12）は見かけには目標に届くが、95% Wilson勝率区間は**約55.2〜95.3%**と非常に広い。元58候補を勝ち58件とみなさず、回数が少なくなったことだけで80%合格と宣言しない。SOURCE元の53候補も相場と停止方法が違うため比較に注意。

期間別 Route B: BASE 2025-10〜2026-09は元45 setupから9件/7勝（net合計+44.854pct-point）、POST 2026-10〜11は13 setupから3件/3勝（合計+24.440pct-point）。PREにはRoute B setupなし。**POSTの3勝はSOURCE P8/P9で一度結果を見たカレンダー**、独立OOSではない。対してRoute AはBASE39 setup→15取引4勝・累計約−38.219pct-point、主損失源。先回りのSELLER継続推定がBTCとPENGUの実際のSQUEEZE/戻りの違いを見誤る。REJECT AそのままのEntry設計。単純にRoute Aを全消しして高勝率を演出せず、**新しい失敗上抜け→再下降の価格戻り待ち構造**へ別路線として作り直す。

30bps＋追加出口滑り10bps/25bpsでもP21 single slotは19勝/34、平均net **+0.902445% / +0.752445%**、PF **1.263206 / 1.215302**、実現損益DD **31.537% / 32.089%**。Portfolio mark-to-market DD20%条件を満たしたと誤称しない。

## 検証・保存

- Precommit `PRISM7_P21_PRECOMMITTED_S3_TO_SELLER_CONFIRMED_M5_STATE_MACHINE_20261122.md`
- コード `scripts/research/prism7_p21_pengu_s3_m5_seller_confirmation_fsm_20261122.py`
- Test `scripts/research/test_prism7_p21_seller_confirmation_source120_20261122.py` **6/6 PASS**：元120候補ID不変、M5確定時刻と次印字の遅延を検証、1枠競合を明記、源原本SHA、条件付き成績/初期セットアップ全母集団を区別、手数料単調。
- 統計 `docs/research-results/prism-phase2-20261122/PRISM7_P21_PENGU_S3_CONFIRM_FSM_SUMMARY_20261122.json`
- 独立候補120＋単一枠120の**全240個票**
 `docs/research-results/prism-phase2-20261122/PRISM7_P21_PENGU_S3_CONFIRM_FSM_240_EVENTS_20261122.jsonl`
- SHA256原本：summary `885a37b96b30935e71513ec2081c7412ac721f29a5eb0e20e77c093c92e9a209`、240 ledger `9caaa536d660285b746fd771cbfbd4c48926e7f0f5f7f15940fae811e8e7eb82`。

**P21本番採用不可、PENGU全体80%未到達、DD20%未到達。** RouteBの特殊な構造は人工squeezeや未見OOSへ反証し、RouteAは新たな売り局面の回復失敗状態へ根本改造する。新SOURCE S3を本番LIVE/STOP/建玉へ書かない。PR #595 Draft研究のみ、PENGU V2/Recovery V8/HYPE/master/Production/VPS/Kill Switch不変更。
