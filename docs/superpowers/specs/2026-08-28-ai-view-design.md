# DisDex ChatGPT確認用SSRページ 設計書

## 目的

認証付きClient UIとは別に、外部HTTPクライアントがJavaScriptを実行せずにDisDexの現在の読み取り専用状態を確認できる`/ai-view`を提供する。通常UIと確認ページの判定情報が乖離しないよう、既存のV12・PENGU・V52観測ローダーを共通のserver surfaceへ集約する。

## 非目標と安全境界

- V12・PENGU・V52の判定、Entry/Exit、Gate、Kill Switch、runner、注文処理は変更しない。
- 注文・取消・決済・テスト注文・synthetic order・建玉変更は実施しない。
- `tradingMutation=0`を維持する。
- Vercelは使用せず、デプロイと本番確認はXServer VPS経路だけで行う。
- APIキー、秘密鍵、認証情報、環境変数、秘密ファイルの絶対パス、注文ID、口座残高、個別数量・価格などの機微情報は公開HTMLに含めない。
- 取得不能な状態を推測で補完せず、`UNKNOWN`、`UNAVAILABLE`、`STALE`、`DATA ERROR`として明示する。

## 推奨アーキテクチャ

### 1. 共通server surface

`lib/server/disdex-observability-surface.ts`を追加し、現在の`app/api/system/decision-status/route.ts`にある以下の組み立て処理を移す。

- `loadDecisionStatus({ force })`
- V12 observabilityの取得と安全なfallback
- PENGU runtime observabilityとV52 Top2 observabilityの取得
- runner状態からのV12 runtime status上書き
- `readOnly: true`と`tradingMutation: 0`

このsurfaceは認証・HTTPレスポンス生成を持たず、サーバー内で直接呼び出せる。既存API routeはcookie検査後にこのsurfaceを呼ぶ薄いadapterにする。`/ai-view`も同じsurfaceを直接呼び、HTTP自己参照や認証cookie依存を避ける。

### 2. 共通portfolio読み取り

既存のAster read-only取得処理は、必要な範囲で`lib/server/live-portfolio.ts`へ抽出する。既存APIのレスポンス互換性を保ちつつ、`/ai-view`には公開安全な投影だけを渡す。

公開投影に含めるのは、取得時刻、取得可否、managed/open positionの件数、既存公開UIで安全に表示している銘柄・LONG/SHORT・保護注文の有無・注文件数とする。残高、available、notional、entry/mark price、quantity、order idは含めない。portfolio取得失敗時は`UNAVAILABLE`または`DATA ERROR`として表示する。

### 3. view-modelとHTML文書モデル

既存の純粋関数`buildDecisionViewModel`を通常UIと`/ai-view`の双方で利用する。必要な型は共有モジュールから型専用で参照できるようにし、判定ロジックをページ側へ複製しない。

`lib/server/ai-view.ts`に、共通surfaceのpayloadを受けて次を生成する純粋な公開文書モデルを置く。

- system status
- `checkedAt`、runner更新時刻、データfreshness、sourceのサニタイズ済み表示
- V12/PENGU/V52のACTIVE/INACTIVE相当のruntime status
- 現在の判定、LONG/SHORT/WAIT、entry成立・未成立
- execution traceの全stageと各stepの`PASS`/`FAIL`/`WAIT`/`BLOCKED`/`UNKNOWN`
- V12候補のRank/score/momentum/volumeRatio/BTC regimeとSignal Gate理由
- PENGU Long/Short eligibility、featuresの公開安全な数値、fail-closed理由
- V52 market/reference状態、window候補、発注阻止理由
- 公開安全なposition/order要約
- `readOnly=true`、`tradingMutation=0`、秘密情報非表示の明示

表示文言はこの文書モデルから生成する。React Server Componentはこのモデルを`h1`、`dl`、`table`、`ul`で出力し、JS fetchやclient hookを使わない。ReactのHTML escapingを利用し、raw HTML文字列生成は行わない。

### 4. routeと公開境界

`app/ai-view/page.tsx`をServer Componentとして追加し、`dynamic = "force-dynamic"`、`revalidate = 0`を設定する。`app/layout.tsx`の公開パスに`/ai-view`を追加してログイン画面を通さない。ただし、ページ自身はサーバー取得した公開投影以外を出力しない。

`app/robots.ts`は現行のサイト全体非公開方針を維持し、`/ai-view`だけを明示的にallowする。WAF、Rate Limit、認証緩和、Vercel設定変更は行わない。root layoutに既存のnoindexがある場合も、アクセス制御と秘密非露出を優先し、検索エンジンへの露出を意図的に広げない。

## データフロー

```text
VPS runner state / sanitized decision snapshot / read-only Aster API
                         |
                         v
       shared server observability surface
             |                         |
             v                         v
  authenticated JSON API       public-safe document model
             |                         |
             v                         v
       normal client UI            /ai-view SSR HTML
```

通常UIは既存の判定APIとportfolio APIを利用し続けるが、両APIの中身は共通server loaderを呼ぶ。`/ai-view`は同じloaderを直接呼ぶため、ルート間でデータ取得の二重実装を持たない。

## エラー処理とFail Closed

- 個別runnerの読み取り失敗は、そのstrategyだけを`UNAVAILABLE`/`UNKNOWN`にし、エラーメッセージは秘密情報やパスを除いた安全な文言にする。
- stale runner、Kill Switch、shared risk、reference不良は既存observabilityの理由を表示し、LIVEやPASSへ昇格させない。
- surface全体の予期しない失敗はHTTP 200を維持する場合でも、文書内のsystem statusを`FAIL CLOSED`、該当項目を`DATA ERROR`として明示する。取得不能を正常稼働と表示しない。
- snapshotにない指標は`未取得`/`UNKNOWN`とし、過去データや固定値で補完しない。
- 公開HTMLの文字列はサニタイズ済みの既知フィールドに限定し、環境変数値・絶対パス・stack traceを出さない。

## 同期漏れ防止テスト

追加するpure self-testは、実データへ接続せず固定された型安全なfixtureを用いて次を検証する。

1. `/ai-view`のdocument modelが共通surfaceのpayloadを要求する。
2. system status、各strategy status、候補・Gate・停止理由、checkedAt、source、`tradingMutation=0`がHTMLに含まれる。
3. `Loading...`だけのHTMLにならず、主要ステータス語が存在する。
4. `PASS`、`FAIL`、`WAIT`、`BLOCKED`、`UNKNOWN`の投影が壊れない。
5. APIキー、秘密鍵、`process.env`、runnerの絶対パス、認証cookie、注文ID、残高等の禁止語・禁止フィールドが出力されない。
6. 通常UIと`/ai-view`が同じsurface/exportを参照する構造を、ソース検査で確認する。

ローカル本番サーバーに対するHTTP self-testでは、`/ai-view`がHTTP 200で、本文に主要情報がサーバー応答時点で存在し、`Loading...`単独でなく、script実行なしで読み取れることを確認する。既存のUI view-model self-testとTypeScript/buildも通す。

## 本番反映と受入条件

- XServer VPSのUI releaseへimmutable SHAで反映する。
- 既存V12/PENGU/V52 runnerを停止・再起動しない。
- UI serviceの稼働、`/ai-view`のHTTP 200、本文のSSR情報、secret scan、既存APIのread-only、`tradingMutation=0`、注文/取消/決済0を確認する。
- 実装が未完成、データが取得不能、またはparity/secret scanが失敗した場合は`STATUS: BLOCKED`とし、LIVE状態を変更しない。

