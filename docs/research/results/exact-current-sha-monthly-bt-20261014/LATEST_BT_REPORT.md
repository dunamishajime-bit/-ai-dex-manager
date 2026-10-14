# 最新Production SHA 1年・1万円・積立なし・複利BT（DD21は設計上限のみ）

## 結論

Production SHA `e8cc2e73f8d3981d708ee52f013241597c038b10` を対象に、2025-08-10〜2026-08-10のH1因果価格モデルを、初期資金10,000円・追加積立なし・複利で再生した。

今回の重要な修正は、V12のDD21を「新規取引を停止する実行Gate」としてBTへ注入しないことだ。DD21はロジック設計・評価上限として記録するだけで、DD21を超えた後も、他の有効なEntry/Exit・Gross・Shared Risk・コスト条件に従って候補を評価する。

主ケースの往復コスト10bpsでは、最終資産は **¥222,196,830.18350622**、閉じた取引は **1,229件**、PFは **4.3269537699**、最大H1時価評価DDは **-28.4804970152%** だった。DD21を超えたことは確認されたが、それによる取引停止は行っていない。

これはAster H1価格・Fundingを用いた因果価格モデルBTであり、歴史的L2板の約定・遅延・部分約定を完全再現した結果ではない。したがって、最終資産を実運用の保証値として扱ってはいけない。

## 固定条件

| 項目 | 条件 |
|---|---:|
| 対象Production SHA | `e8cc2e73f8d3981d708ee52f013241597c038b10` |
| 期間 | 2025-08-10 00:00 UTC ～ 2026-08-10 00:00 UTC |
| 初期資金 | ¥10,000 |
| 毎月積立 | ¥0 |
| 複利 | ON |
| 主コスト | 往復10bps |
| ストレス | 往復20bps / 30bps |
| 対象 | V12 / PENGU / Q102 / V52 / FET / HYPE / IDLE / RESIDUAL |
| 実注文・取消・建玉変更 | すべて0 |
| V12 DD21停止Gate | 適用しない |
| DD21 | 設計・評価上限として報告 |

## コスト別結果

| 往復コスト | 最終資産 | 純利益 | 月次幾何平均換算 | PF | 最大MTM DD | 勝率 | 取引数 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10bps | ¥222,196,830.18 | ¥222,186,830.18 | 130.2651% | 4.32695377 | -28.4805% | 69.9756% | 1,229 |
| 20bps | ¥147,893,999.67 | ¥147,883,999.67 | 122.5850% | 3.73201667 | -28.6620% | 68.1301% | 1,230 |
| 30bps | ¥87,920,529.45 | ¥87,910,529.45 | 113.1445% | 3.06472527 | -29.4490% | 66.5041% | 1,230 |

月次幾何平均換算は、各ケースの最終資産を初期資金10,000円から12か月で割り戻した参考値であり、毎月その利率を実現したという意味ではない。

## 10bps月次推移

開始月と終了月は期間端の部分月。積立は一度も行っていない。

| 月 | 月末資産 | 月次騰落率 | 積立 |
|---|---:|---:|---:|
| 2025-08（部分月） | ¥11,395.42 | +13.9542% | ¥0 |
| 2025-09 | ¥22,229.24 | +95.0718% | ¥0 |
| 2025-10 | ¥113,058.76 | +408.6039% | ¥0 |
| 2025-11 | ¥296,825.19 | +162.5406% | ¥0 |
| 2025-12 | ¥660,813.22 | +122.6271% | ¥0 |
| 2026-01 | ¥1,838,690.16 | +178.2466% | ¥0 |
| 2026-02 | ¥6,755,944.41 | +267.4325% | ¥0 |
| 2026-03 | ¥15,844,200.16 | +134.5224% | ¥0 |
| 2026-04 | ¥30,605,520.98 | +93.1655% | ¥0 |
| 2026-05 | ¥74,665,837.08 | +143.9620% | ¥0 |
| 2026-06 | ¥194,697,709.43 | +160.7588% | ¥0 |
| 2026-07 | ¥227,295,141.69 | +16.7426% | ¥0 |
| 2026-08（部分月） | ¥222,196,830.18 | -2.2430% | ¥0 |

## ロジック別寄与（10bps）

| ロジック | 取引数 | 実現損益寄与 |
|---|---:|---:|
| V12 | 839 | +¥123,447,683.52 |
| HYPE LONG | 19 | +¥38,329,423.54 |
| V52 | 87 | +¥31,556,941.76 |
| PENGU | 67 | +¥17,317,338.89 |
| Q102 | 138 | +¥8,602,479.37 |
| IDLE | 51 | +¥6,901,205.92 |
| FET | 5 | +¥1,131,885.33 |
| RESIDUAL | 23 | -¥2,379,946.73 |

ロジック別実現損益の合計と円建て純利益との差は、期間中のUSD建て決済残高を日次ECB FXで円換算する経路差である。会計照合は3ケースすべてPASS。

## DD21の扱いと今回の修正

以前のBTは、V12最大DDが21%を超えた後に新規V12 Entryを拒否するGateを研究ハーネスへ注入していた。その誤った再生では、10bpsの最終資産は約¥14,452,316、閉じた取引は666件、V12取引は230件だった。

修正版では、DD21によるV12拒否は **0件**。10bpsではV12取引839件、全体1,229件となった。差分の本質は、ロジックの勝手な緩和ではなく、ユーザーが指定した「DD21は設計・評価上限であり、取引停止設定ではない」という意味にBTを合わせたことにある。

ただし、チェックアウトされたProductionソースには、`lib/v12-v4-production-lifecycle.ts` と `lib/v12-v4-shared-reservations.ts` にDD21をEntry/Reservationへ適用する実行ガードが残っている。これは研究結果と本番コードの契約不一致であり、今回のBTだけで「最新Productionコードと完全一致」とは主張しない。VPS・Aster・Production runtimeは今回変更していない。

## 現行契約の主な適用

- V12 V4 `V2_M150_D05_CORE_NATIVE`、41 routes
- V12 Gross `3.0x`、Recovery Gross `2.5x`
- V4 entry authority Crypto `3.5x` / Total `4.75x`
- Peer entry authority Crypto `3.0x` / Total `4.25x`
- DD21は設計・評価上限として記録し、今回のBTのV12 trade-stopには使用しない
- TIME family 固定8% emergency STOP
- PENGU `COMBINED_FILTERED_Q60_DD17_H72`、accepted entry Gross `1.0x`
- Q102現行family/side sizing、BRK disabled
- FET `BRK48_VOL10_RET15`、Gross `1.0x`
- HYPE 1.5x、V52、IDLE、RESIDUAL、Shared Daily Loss、所有権競合
- Aster `5x Cross`（証拠金設定であり、strategy Grossを5倍にしない）

## 再現性

- 固定candidate ledger: 3,086行
- V12 unique routes: 41
- Raw Aster H1/funding files: 72
- V52 source files: 3
- External V4 research Python sources: 136
- Current target policy Git-object files: 12
- Current parity evidence files: 4
- Canonical output files per run: 15
- Independent corrected replays: 2
- Canonical file differences: 0
- Corrected canonical hash-manifest SHA-256: `0b49802f128c38c3ec467b76bf123afd4fe64dbc926c85975efc43b665659f27`
- Corrected current-contract summary SHA-256: `fa4956ac6b2ca06b32d1ca148d8e44ce82d34547a207a940234d6187041c7d10`
- Corrected monthly results SHA-256: `64f3593a7018887983d2081269e1cdbd5371d7f13b4070ba1223fd371af907b8`
- Accounting reconciliation: 3ケースすべてPASS
- 初期入金イベント: 各ケース1回のみ
- 追加積立: 0回
- Orders / cancels / position changes: 0 / 0 / 0

## データと限界

候補行には元の生成SHA `dbf845...` / `ce1edee...` を残し、最新SHAへ偽装していない。最新SHAのソースhash、41 routesのEntry/Exit parity証拠、現行ポリシーによる再判定で対象SHAへ拘束している。

この再生はAster H1価格・Fundingと保存済みV52原本を使う因果価格モデルBTであり、歴史的L2板の厚み・queue position・venue/network latency・partial/unknown execution・当時のminQty/minNotional変更・signed venue read-backを完全には再現しない。従って、最終資産や月次利率は実運用の保証ではない。
