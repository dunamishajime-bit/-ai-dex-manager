# AI DEX Manager (AI-DEX マネージャー)

> **VPS作業を行うAIへの必須事項**：Xserver VPSにアクセスする前に、[AGENTS.md](AGENTS.md) と [Git for Windows SSH 接続手順](docs/ops/DISDEX_VPS_SSH_ACCESS_20261012.md) を必ず確認してください。Windows標準ssh.exe（exitCode=255）ではなく、所有者Windows PC上の検証済みGit SSHスクリプトを使用します。Production操作前には必ず最新の建玉・保護STOP・Runner・Risk Gateを再監査してください。


未来的なUIと高度なAIエージェント機能を備えた、分散型取引所(DEX)向け管理ダッシュボードのプロトタイプです。

## 🚀 主な機能

*   **サイバーパンク・デザイン**: グラスモーフィズム、ネオンエフェクト、グリッドアニメーションを採用した没入感のあるUI。
*   **AI評議会 (AI Council)**: 4つの異なる個性を持つAIエージェント（ストラテジスト、トレーダー、リスク管理、アナリスト）が市場を分析し、議論します。
*   **戦略提案システム**: AIが市場状況に応じて戦略変更を提案し、ユーザーが承認/拒否を行えます。
*   **リスク管理**: 損切り(Stop Loss)と利確(Take Profit)の閾値を設定し、自動でポジションを決済するシミュレーション機能。
*   **日本語完全対応**: インターフェースおよびAIの対話ログはすべて日本語化されています。
*   **セキュリティ**: パスワードによる簡易アクセス制限。

## 🛠️ 技術スタック

*   **Framework**: Next.js 14 (App Router)
*   **Language**: TypeScript
*   **Styling**: Tailwind CSS, CSS Modules
*   **Icons**: Lucide React
*   **Charts**: Recharts
*   **State Management**: React Context API

## 🏁 開始方法

### 1. インストール
```bash
npm install
```

### 2. 開発サーバーの起動
```bash
npm run dev
```
ブラウザで [http://localhost:3000](http://localhost:3000) にアクセスしてください。

### 3. ログイン
初期設定されているパスワードのいずれかを入力してください:
*   `admin`
*   `password`
*   `ai`

## 📱 スクリーンショット

*   **ログイン画面**: 未来的なセキュリティターミナル風デザイン。
*   **ダッシュボード**: 資産状況、リアルタイムチャート、AIチャットログを一画面に集約。

改行追加

## ⚠️ 注意事項

本アプリケーションは**シミュレーション**です。実際のブロックチェーン上の取引は行われません。価格データおよび取引はすべてブラウザ内で生成された模擬データです。
