# Life Partner

忘れ物・タスク・お金の管理をひとつにまとめた、生活支援のための PWA（ホーム画面に追加して使う Web アプリ）です。
利用者に努力や我慢を求めるのではなく、アプリの仕組みで日常の負担を減らすことを目指しています。

> 医療・診断・治療を目的としたアプリではなく、日常生活を補助するツールです。

## 主な機能

| 機能 | 内容 |
|---|---|
| ホーム | 日付・今日使える金額・持ち物チェック・今日やること・1週間の予定・保存状況。ホームから直接チェック／タスク完了／支出登録 |
| 忘れ物チェック | 用途別ひな形（仕事・学校・買い物・通院・旅行・外出）、自分のひな形、並び替え、毎日の自動リセット、チェック履歴 |
| タスク | 期限・優先度・カテゴリー・メモ・繰り返し、小さなステップへの分解と進捗表示、自動繰り越し、集中モード |
| お金 | 2タップの支出登録、収入・固定費・予算・給料日・貯金目標、今日使える金額と計算の内訳、月別・カテゴリー別集計、CSV 出力 |
| データ保護 | IndexedDB への即時保存、オフライン動作、Supabase とのクラウド同期（競合検知つき）、JSON バックアップ／検証つき復元／復元の取り消し |
| その他 | ライト／ダーク、文字サイズ、アニメーション停止、使わない機能の非表示、アプリ内リマインダー |

## ドキュメント

| ファイル | 内容 |
|---|---|
| [docs/USER_MANUAL.md](docs/USER_MANUAL.md) | 利用者向けのかんたん操作マニュアル |
| [DEPLOYMENT.md](DEPLOYMENT.md) | iPhone だけで GitHub / Vercel / Supabase を設定・公開する手順 |
| [IPHONE_TEST.md](IPHONE_TEST.md) | iPhone 実機テストの手順とチェック表 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 設計（保存・同期・PWA） |
| [DATABASE.md](DATABASE.md) | 端末内 DB とクラウド DB の構造、スキーマ変更のルール |
| [SECURITY.md](SECURITY.md) | セキュリティ・プライバシー |
| [TEST_REPORT.md](TEST_REPORT.md) | テスト結果（実装済み／検証済み／未検証の区別） |
| [CHANGELOG.md](CHANGELOG.md) | 変更履歴 |

## 開発

```bash
npm install
npm run dev          # 開発サーバー
npm test             # 単体テスト（Vitest + fake-indexeddb）
npm run test:sql     # Supabase 用 SQL と RLS の検証（ローカル PostgreSQL 16 が必要）
npm run test:e2e     # ブラウザテスト（Playwright / iPhone 13 サイズ）
npm run build        # 本番ビルド（dist/）
```

環境変数は `.env.example` を参照してください。Supabase を設定しなくても「この端末にのみ保存」モードで全機能（同期以外）が動きます。

## 技術構成

React 19 / TypeScript / Vite / Dexie.js（IndexedDB）/ Supabase（認証・PostgreSQL）/ 自作 Service Worker / Web App Manifest / Vercel / GitHub Actions
