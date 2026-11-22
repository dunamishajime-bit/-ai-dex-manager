# STABLE4｜V4 DD30%正式採用方針（2026-11-23）

Ownerの指示により、元STABLE4のV4新規注文DD停止基準を21%から30%に変更した。研究版PENGU Binance独立発火・ASTER M5方式およびP100ポイント制は今回採用しない。

## 変更範囲

- config/v12V4AdoptionRiskPolicy.ts：V12_V4_MAXIMUM_DRAWDOWN = 0.30
- 参照先は lib/v12-v4-shared-reservations.ts のV4新規ENTRY共有予約判定と、lib/v12-v4-production-certification.ts の証拠審査。
- DDが29.9%または30.0%ならこのDD条件単独ではV4 ENTRYを拒否せず、30.1%を超えればV4_SHARED_RESERVATION_HOLDで拒否する。他の安全審査はすべて従来どおり必須。
- **DD30%は全口座の最大DD30%の保証でも、既存建玉の自動一括決済指示でもない。**
- GLOBAL HOLD、Shared Kill Switch、Shared Risk日次7.5%、PENGU独自DD17%、既存STOP・reduce-only EXIT、H48、Funding、Gross、現建玉照合は変更しない。
- 旧DD21%のOwner承認SHA・計画は、新しい経済条件でのLIVE発注許可を意味しない。別の正規Owner承認とCodex正式切替が必要。

## 研究証拠：元STABLE4（2025-10-01～2026-10-01、複利、初期1万円）

| V4のDD停止 | 10bps 最終資産 | 10bps 最大DD | 30bps 最終資産 | 30bps 最大DD |
|---|---:|---:|---:|---:|
| 21% | ¥13,541,227 | 21.57% | ¥4,923,412 | 22.28% |
| 30% | ¥26,876,408 | 32.00% | ¥9,382,484 | 31.62% |

10bpsのV4モデル約定496→764、30bpsは494→763。全モデル約定10bpsは795→1,014、30bpsは791→1,011。
研究BTで30%初回超過は10bpsが2026-07-15 12:50 UTC、30bpsが同日14:10 UTC。**採用するDD30では実際に約32%まで下落する可能性が示されている。**

研究ソースはresearch/stable4-dd30-sensitivity-20261123のcommit 73cd02c3、ファイル research/prism7/stable4_dd30/STABLE4_DD30_SENSITIVITY_AND_STRATEGY_SELECTION_20261123.md。
V52歴史的価格モデルには板・署名取引の再現不足があり、本番利益や最大DDの一致を保証しない。

## 事前テストとCodexへの必要条件

実際のV4共有予約経路でDD21%、29.9%、30.0%を許容、30.1%と32.0%を拒否する境界を検証。既存の保護STOP処理は不変。ソースSHAの検証と、元のDD21を誤って再採用する設定を拒否するテストを追加。

Codexは最終切替に際し、(1)DD30の本番ソース・署名/Owner planとの整合、(2)GLOBAL HOLD保護、(3)取引所建玉/STOP所有権、(4)V4/FET停止・Q102/Margin Guard再起動ループの解消、(5)本番と研究の価格・H48・Funding・Gross整合、(6)正式GitHub ActionsおよびHPの新しいOwner承認を確認する。

このブランチはPRE-LIVEのコード候補であり、本番取引・注文権限・STOP変更・VPS切替は行っていない。
