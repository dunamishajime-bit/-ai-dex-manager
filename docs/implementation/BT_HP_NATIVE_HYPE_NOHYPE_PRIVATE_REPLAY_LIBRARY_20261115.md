# BT #481 — HYPE TREND/無採用の4件の研究用リプレイを生成・SHA検証（2026-11-15）

## 完了した範囲

STABLE4の対象年研究エンジンをもとに、HYPEだけをnative TRENDの78候補へ差し替えたケースとHYPEを採用しない対照ケースを、**各10bps/30bpsの2費用モデル**でHP専用Replay JSONへ変換した。オリジナル研究CSV/Fill/Forex/QuantityをGitHubや`public/`へ配置していない。結果はOwner PCのみ：

`C:\tmp\bt481-hp-replay-library-native-hype-nohype-20261115`。

| 研究ケース | 10bpsモデルFill | 10bps フレーム | 30bpsモデルFill | 30bps フレーム |
| --- | ---: | ---: | ---: | ---: |
| native HYPE TREND | 1,024 | 8,985 | 1,025 | 8,984 |
| HYPE採用ゼロ対照 | 1,018 | 8,976 | 1,020 | 8,977 |

全ケースは、検証済みのAster public BTC確定H1足8,928本、入場・決済・PENGU部分決済、Fundingモデル、source Gross/期末モデル建玉を参照。数量・USD/JPY換算が元資料にない場合、価格/数量を捏造せずnullを保持。各ReplayのengineShaは`UNVERIFIED_RESEARCH_BACKTEST`、sourceStatusには`NOT_FULL_PRODUCTION_PARITY`を含めたままにする。

各INDEXが保持するファイルサイズ・SHA256とReplay JSON内部のsource summary・モデル件数・Crypto/Stock/Total Gross cap・戦略系統数を`lib/server/bt-research-library.ts`の`readResearchReplay`を通じて全4件PASS。native HYPEは研究売買7系統、HYPEなしは6系統。現行production runner manifestは7売買系統＋2管理系統であり、HYPEなしの6を本番の「6つしか稼働していない」意味にしない。

## BTページ上の誤認防止

既存H48専用のHYPE経路差分は従来どおり旧研究ケース限定。一方、V4のCodex切替後manifest pin `e788abc82e80f9fc7ab0e1ba83fdb8be267eb513` と元研究V4 source pinとの不一致は、旧H48/native TREND/no-HYPEの**3つの源研究ケースすべて**に個別表示する。新たな`lib/bt-verification/source-pin-observation.ts`に固定済み時点観測の対象ケース集合を用意して、未確認の研究ケースに誤表示しない。

## 再現・検証

Replay生成：`scripts/bt_hp_build_replay_library.py`に2つの元研究フォルダを渡し、Aster BTC H1の圧縮OHLCVを添付。生成先はPrivateの別フォルダで、既存のSTABLE4 H48/旧Replayを上書きしない。

実体検査：`scripts/bt-hp-native-nohype-research-library-selftest.ts`。環境変数`DISDEX_BT_RESEARCH_LIBRARY_DIR`へprivateフォルダの**絶対パス**を明示した場合のみ作動し、4つのモデル件数、HYPE有無、sourceSHA256、BTC OHLCV、Gross cap、sourceStatusを検証。未指定ならFail Closed。V4表示警告は`bt-hp-v4-pin-notice-selftest.ts`で3ケース・未知ケースの識別を検証。

このPrivateライブラリ作成は**HP本番公開とは別**。本番HPへの配置、GitHub PRマージ、Owner承認、 LIVE取引・STOP・KillSwitch変更は本タスクでは未実施。