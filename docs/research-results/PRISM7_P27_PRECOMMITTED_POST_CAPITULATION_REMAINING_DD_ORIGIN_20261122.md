# PRISM VII P27 — CAPITULATION捕捉後にも残るM5 close DD21.96%のピーク帰属と正しいSHORTの保護（結果計算前固定）

既にP26で本研究 `PENGU_S4_CAPITULATION_CAPTURE_V1` main (P25 30bps/第2positive M5/追加滑り0) を同じSOURCE positive M5と第1倍・1slotで再現し、**M5 close DD21.95877323% / high対直前完成M5 peak DD21.95877323%** を確認。残る最悪谷 `S3_10500` は2026-10,元reference ENTRY0.00798/72H EXIT0.00743の**利益取引**で、元entryに対する最大悪化は約0.6%にすぎない。元のSOURCE V20/PENGU3構造を改変して「負けだから除外」とする誤りを防ぐ必要がある。

## 事前固定する独立計算

- P22元H1構造setup120 / P25検出event120を固定し、P25の研究EXIT overlayを **第2positive M5, 追加滑り0bps** でSOURCE `apply_single_slot`へ再適用。SOURCE entryTs/price, reference STOP72, source hard/trailing/time, right-censored1件を全部保持。値がP25の120candidate/21完了15勝・元P26のclose DD21.95877323%に一致しなければFail Closed。
- 元P24と同じ初期資本10,000円/1倍/両側合計30bpsをsource positive M5 CLOSEおよび仮想EXIT M5 OPENに時間順に再計算。running peakが新しくできるとき、**ピークを作った取引ID・M5 timestamp・価格・実現済みcashか未実現markか・対応時点の資金**を保存。peak→valleyでは「同じ取引の逆行」と「前取引の未実現ピークと別の正しいSHORT保有中の谷」を明確に区別。
- P25 mainとP26 MarkDDと最大HIGH stress値を照合。今後の判断で`S3_10500`を損失取引として誤登録してはいけない。全22 modeled trade sourcesのMFE/MAE、positiveM5 printsとPnL/entry/exit、global peakAtEntry、worstDrawdownInTradeを保存。
- M5 HIGH stressの意味はP26の **直前完了M5ピーク vs 当該バーHIGH** に固定。P23旧式same-bar close-peek vs先行highは参考境界として別保存。無出来高価格を執行可能と誤称しない。
- 新しい経済ルールはこのフェーズで実装しない。P25は既知の2025Oct shockで設計した1件のみの改善で、過学習・ソース流動性の問題を解消していない。目標DD20%・勝率80%の達成主張禁止。次フェーズで違う構造の入口/資金リスクを試す場合も既見source labelに合わせた閾値最適化をしない。
- GitHub Draft PR #595のみへ新分析/sha/回帰を保存。master/VPS/Runner/STOP/実注文/建玉/HYPE/SharedRisk/KillSwitch変更なし。
