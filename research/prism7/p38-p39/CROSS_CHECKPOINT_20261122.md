# PRISM VII P38/P39 cross-family audit checkpoint

研究専用。2026-11-22。固定Gross 0.75x。Native53とS4を混同しない。

P38：64 scenarios、19決済14勝、基準DD 17.03%、NAV 24,029円。
P38全買戻し100bps追加ストレス：DD 20.37%、NAV 21,130円。20%超。
P39：32 scenarios。Original Native53 29勝（54.72%）。
元Native53の出口価格53/53でP35一致。P38の各M5判定移植で勝率悪化。
M5直前60分で出来高不足6件、うち勝ち取引5件。ゼロ補完せず判定不可。
追加買戻し100bpsでNative53単独損益合算は 39.78→0.54 元本比ポイント。
NOTE: Native53の単独損益合算は重複建玉を考慮しておらず、複利NAV/DDを表さない。
NOTE: 検証済期間PRE/BASE/POSTは過去に何度も探索済み。未見OOSではない。
NOTE: S4構造入口と元Native V20入口は一致せず、元53の80%改善を示せない。
本番Runner/建玉/STOP/Kill Switchには変更なし。採用候補なし。

## SHA256 evidence
- prism7_p38_causal_multihorizon_entry_20261122.py: 5ec09ed480d827e7753fb4ec6651194e6f5c399efc0c35b26ea4a29b7877e54a
- prism7_p39_original_native53_m5_causal_transfer_20261122.py: 6fad4fde4b21312f48871e11687324aca3e1c05c68d538f68cb9ae194ace813e
- PRISM7_P38_M5_CAUSAL_MULTI_HORIZON_ENTRY_ABLATION_20261122.json: c6b79e2a9aead706f212bbf12fda3cc90efd11cc84af1031281f46f3723b74c3
- PRISM7_P39_ORIGINAL_NATIVE53_M5_CAUSAL_TRANSFER_20261122.json: 6646e74e1d2f87d356e6855cb397799bbcc0ac20d901fcdd38163a749ba72310
- PRISM7_P38_M5_CAUSAL_ALL120_SOURCE_FEATURES_20261122.jsonl.gz: 7a19e4f730bd50457a32030476d0cd85088e75b97090627ea520cb5e5aa2cc43
- PRISM7_P39_ORIGINAL_NATIVE53_M5_ASOF_FEATURES_20261122.jsonl: a92d016487a0a85b31ff5355091e052fc3cb21a8a5ebeb58d3a001e7bc1a1f45
