# P107 — 修正済み研究結果 (2026-11-22)

## 実施した修正

1. p107_manifest_gate.py の固定Gross判定を修正。旧コードは Stock 1.5x / Total 3.5x をLIVE一致条件と誤認していた。VPS固定ソースの Crypto 3.0x / Stock 4.0x / Total 4.25x を研究用SOURCE_PROFILEとして分離し、1.5/3.5は感応度シナリオ扱いに変更。不明値はfail closed。
2. VPSのQ102起動環境を読み取り専用で点検し、QUALITY102_CAUSAL_V1_MAX_GROSS=0.50を確認。現行稼働状態ではQ102・V52・Shared Riskがrunning、V4はfailed、HYPEはinactive。これは「全Runnerを仮稼働するBT」とは別。
3. 2026-11-13旧基準研究エンジンの注文受理直前にQ102 gross 0.50 capを組み込んで、10/30bps両方を完全再実行。fills・decisions・funding・equityを作成し、Q102全fillのgross<=0.50をテストした。

## 計算結果 (あくまで旧SHA研究エンジンの感応度。現行STABLE4のFULL PARITYではない)

| bps | NAV修正前 | NAV修正後 | 最大DD前 | 最大DD後 | 勝率後 | fill前→後 |
|---|---:|---:|---:|---:|---:|---:|
|10|¥887,336|¥2,752,972|56.31%|44.11%|59.91%|537→873|
|30|¥321,162|¥402,959|63.20%|53.94%|55.80%|537→672|

全ケース最大DD20%以下に未達。現在の固定V4/Q102/HYPE/V52 source-native信号、H48出口、STOP、V52 H1 proxyとmicrostructureを再実装・検証しなければP107完全一致PASSにはできない。追加資料は JSON report と 9ファイルのZIP、全20ファイルのSHA256一覧を参照する。原本の時間足 equity 約25MB は所有PCの隔離研究フォルダに保存済み。

テスト: python -m unittest discover -s research/prism7/p107 -p test_p107_manifest_gate_policy.py -v

本番注文・LIVE設定・Kill Switchの変更は0。
