# BT #481 — V4 REC_Y06の誤SHORT方向・非独立Episode監査（2026-11-15）

## 判定

**`V4_Y06_DIRECTION_PROXY_DRIFT_NO_GATE_PRODUCTION_PROMOTION`**。V4 `REC_Y06_REV_D0_T72` の研究用source pin `3ad65403013b701db5d9e53e8814e6ab827a28e8` を前提とした2025-10〜2026-10のモデル候補352件を読み直し、方向誤りのラベル傾向と同一相場Episodeの多重発火を別々に検証。本番稼働中のV4はCodexによる切替が進行しているため、これを現在の本番pinの完全一致とは扱わない。

| 研究用の時間順分割 | 取引モデル候補数 | モデル上の方向誤り件数 | 誤り率 |
| --- | ---: | ---: | ---: |
| Train | 211 | 39 | **18.48%** |
| Validation | 70 | 33 | **47.14%** |
| Test | 71 | 48 | **67.61%** |

研究用誤りラベルの比率がTrain→Testで **49.12ポイント悪化**したことを確認。これは独立モデルの方向ラベル評価であり、取引所約定でのマイナスや勝率とイコールではない。相場の転換・価格レジーム・同一Episodeでの重複発火が背景にあり得るため、誤り率上昇を原因特定済みとは言わない。

### 高度な市場breadth特徴の品質と限界

- 完全に確定したH1を入力とした市場breadth特徴は352イベント×8項目＝2,816比較すべて元研究値と完全一致、live/incomplete barは使用しない。BTCはbreadthユニバースから除外されている。
- 72時間の決済ラベルが確定してから学習へ利用できるようにpurge：Train211のうち208、Validation70のうち54で成熟時点のデータを区切る。
- native-onlyモデルのValidation AUC **0.381**、breadth追加モデルのValidation AUC **0.329**。両モデルとも同分割で5件の有害な反転／改善0件、`accepted=false`。
- Holdout TestのAUCのみを見て採用すると検証損失が隠れるため、**どちらのGateも導入しない**。

### 同じ暴騰・下落局面からの候補重複

- 研究対象352イベントを、保有期間が重なり得る同一相場Exposure Episodeへまとめると **31 Episode**。取引候補を352独立の学習サンプルとして扱うのは過剰な確信につながる。
- EpisodeをTrain/Validation/Test境界でまたぐものは **2件**あり、単なる日付分割を独立な市場検証と見なせない。
- 元研究のH60短縮ExitのEpisode再標本化における累計モデルreturn差95%帯は **−0.854〜＋1.515**でゼロを跨ぐ。研究者自身がIID仮定・未来パフォーマンスに対する正式信頼区間ではないと注記している。

## 検証コード・証拠

`scripts/bt_hp_v4_y06_direction_episode_audit.py`：352件・280ユニークentry hourの元population、train/validation/test誤方向proxy、as-of H1特徴の完全一致、72時間purge、2方向モデルのOOS不採用、31 Episodeの352イベント対応・重複禁止、split-crossing・Bootstrapの留保条件を全件チェック。

`tests/test_bt_hp_v4_y06_direction_episode_audit.py`：8件の合成検証（未来バー混入、不正な分割、重複Episode、未証明Gate採用の拒否）。BT Python回帰テスト**185件PASS**。

Private結果：`C:\tmp\bt481-v4-y06-direction-episode-audit-20261115.json`。SHA256 `17B6018089AF9D7990AD60BB8B24EE56BF9F48DE147BA253D48BD4427FF86DB2`。

## 継続方針

誤判定の深掘りは351件の独立取引ではなく、**31 Episodeベースの相場レジーム変化とOOS誤判定数**を評価単位にする。ここから対象年の誤SHORTを回避できた特徴を後知恵で最適化しても採用しない。必要なのは対象年以前の原因変数・前方別期間・人工相場・閾値揺らしでの頑健性と、全RunnerのGross・DDへの反映。V4のLIVE切替はCodexに任せ、本研究からV4や取引注文・STOPを変更しない。